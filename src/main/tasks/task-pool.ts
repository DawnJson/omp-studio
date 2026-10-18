// 任务池：持有所有任务的运行时，管进程上限、空闲回收、快照淘汰、关闭。
// 规则见 docs/architecture/task-model.md（arch 2.3）：软上限默认 6，按最近使用回收可回收的空闲任务；
// 没有可回收的就超出软上限照起，到硬上限（软上限 × 2）才拒绝；可回收状态持续 15 分钟定时关闭。
import { stat } from "node:fs/promises";
import type {
  CreateTaskInput,
  DialogResponse,
  ModelKey,
  ModelOption,
  Project,
  ProjectId,
  PromptInput,
  RestoredDraft,
  RestoredQueue,
  StudioSettings,
  TaskId,
  TaskNotice,
  TaskState,
  TranscriptBatch,
  TranscriptSnapshot,
} from "../../shared/ipc.ts";
import type { AvailableSlashCommand, ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { OmpLaunch } from "../omp/omp-connection.ts";
import { titleFromPrompt } from "./convert.ts";
import { TaskRunner, TooManyTasksError, type RunnerHost } from "./task-runner.ts";
import type { TaskRecord, TaskRegistry } from "./task-registry.ts";

export const IDLE_RECYCLE_MS = 15 * 60_000;
export const SNAPSHOT_LRU_SIZE = 10;
const SHUTDOWN_CLOSE_TIMEOUT_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

export interface PoolEvents {
  state(state: TaskState): void;
  transcript(batch: TranscriptBatch): void;
  notice(notice: TaskNotice): void;
  taskRemoved(id: TaskId): void;
  slashCommands(taskId: TaskId, commands: AvailableSlashCommand[]): void;
}

export interface PoolDeps {
  registry: TaskRegistry;
  getSettings(): Promise<StudioSettings>;
  buildLaunch(record: TaskRecord, project: Project): Promise<OmpLaunch>;
  assignJob(pid: number | undefined): void;
  events: PoolEvents;
}

export interface ResumeInput {
  sessionFile: string;
  cwd: string;
  projectId: ProjectId;
  /** null 时取会话里第一条用户消息的第一行（调用方给不出时留空，由首次打开后的标题回填）。 */
  title: string | null;
}

export class TaskPool {
  readonly #deps: PoolDeps;
  readonly #runners = new Map<TaskId, TaskRunner>();
  readonly #recyclableSince = new Map<TaskId, number>();
  #foreground: TaskId | null = null;
  #sweepTimer: NodeJS.Timeout | undefined;
  #shuttingDown = false;
  readonly #host: RunnerHost;

  constructor(deps: PoolDeps) {
    this.#deps = deps;
    this.#host = {
      buildLaunch: (record, project) => deps.buildLaunch(record, project),
      assignJob: (pid) => deps.assignJob(pid),
      persist: (id, patch) => deps.registry.updateTask(id, patch),
      isForeground: (id) => this.#foreground === id,
      acquireSlot: (id) => this.#acquireSlot(id),
      onState: (state) => deps.events.state(state),
      onTranscript: (batch) => deps.events.transcript(batch),
      onNotice: (notice) => deps.events.notice(notice),
      onSlashCommands: (taskId, commands) => deps.events.slashCommands(taskId, commands),
    };
  }

  /** 载入 tasks.json，为未归档的任务建（还没有进程的）运行时，并开始定时回收。 */
  async init(): Promise<void> {
    await this.#deps.registry.load();
    for (const record of this.#deps.registry.listTasks()) if (!record.archived) this.#adopt(record);
    this.#sweepTimer = setInterval(() => void this.sweep(Date.now()), SWEEP_INTERVAL_MS);
    this.#sweepTimer.unref();
  }

  #adopt(record: TaskRecord): TaskRunner {
    const project = this.#deps.registry.findProject(record.projectId);
    if (!project) throw new Error(`task ${record.id} refers to unknown project ${record.projectId}`);
    const runner = new TaskRunner(record, project, this.#host);
    this.#runners.set(record.id, runner);
    return runner;
  }

  #runner(id: TaskId): TaskRunner {
    const runner = this.#runners.get(id);
    if (!runner) throw new Error(`unknown task ${id}`);
    return runner;
  }

  // ───── 项目 ─────

  listProjects(): Project[] {
    return this.#deps.registry.listProjects();
  }

  /** 已有同路径项目就返回它；会话恢复时自动加入，不弹框。 */
  ensureProject(cwd: string): Promise<Project> {
    return this.#deps.registry.addProject(cwd);
  }

  async removeProject(projectId: ProjectId): Promise<void> {
    if (!this.#deps.registry.findProject(projectId)) throw new Error(`unknown project ${projectId}`);
    if (this.#deps.registry.listTasks().some((task) => task.projectId === projectId && !task.archived))
      throw new Error("project still has tasks; archive them first");
    await this.#deps.registry.removeProject(projectId);
  }

  /** 含已归档的任务；历史列表据此填 SessionSummary.taskId。 */
  listSessionLinks(): { id: TaskId; projectId: ProjectId; sessionFile: string | null }[] {
    return this.#deps.registry.listTasks().map(({ id, projectId, sessionFile }) => ({ id, projectId, sessionFile }));
  }

  // ───── 任务 ─────

  listTasks(): TaskState[] {
    return [...this.#runners.values()].map((runner) => runner.state);
  }

  async createTask(input: CreateTaskInput): Promise<TaskState> {
    const project = this.#deps.registry.findProject(input.projectId);
    if (!project) throw new Error(`unknown project ${input.projectId}`);
    const settings = await this.#deps.getSettings();
    const record = await this.#deps.registry.addTask({
      projectId: project.id,
      sessionFile: null,
      title: "",
      model: input.model ?? settings.defaultModel,
      thinkingLevel: input.thinkingLevel ?? settings.defaultThinkingLevel,
    });
    const runner = this.#adopt(record);
    this.#startInBackground(runner);
    return runner.state;
  }

  /** 启动失败时状态已是 error 并已推送；这里不重复抛出（没有调用方在等）。 */
  #startInBackground(runner: TaskRunner): void {
    runner.start().catch(() => {});
  }

  async resume(input: ResumeInput): Promise<TaskState> {
    const project =
      this.#deps.registry.findProject(input.projectId) ?? (await this.#deps.registry.addProject(input.cwd));
    const existing = this.#deps.registry.findTaskBySessionFile(input.sessionFile);
    if (existing) {
      const live = this.#runners.get(existing.id);
      if (live) return live.state;
      // 已归档的任务恢复成未归档（同一 id，侧栏的"撤销"）；它的项目可能已被移除，挂回会话自己的 cwd 对应的项目。
      const runner = this.#adopt(
        await this.#deps.registry.updateTask(existing.id, {
          archived: false,
          ...(!this.#deps.registry.findProject(existing.projectId) && { projectId: project.id }),
        }),
      );
      this.#deps.events.state(runner.state);
      return runner.state;
    }
    await stat(project.path); // cwd 已不存在时报错，不替用户"迁移会话"（arch 1.6）
    const settings = await this.#deps.getSettings();
    const record = await this.#deps.registry.addTask({
      projectId: project.id,
      sessionFile: input.sessionFile,
      title: input.title === null ? "" : titleFromPrompt(input.title) || input.title,
      model: settings.defaultModel,
      thinkingLevel: settings.defaultThinkingLevel,
    });
    const runner = this.#adopt(record);
    this.#startInBackground(runner);
    return runner.state;
  }

  /** 切到这个任务：需要时拉起 omp 并恢复会话，返回对话快照，并清除 unread。启动失败不抛，状态里有 error。 */
  async openTask(id: TaskId): Promise<TranscriptSnapshot> {
    const runner = this.#runner(id);
    this.#foreground = id;
    runner.markRead();
    if (runner.status === "stopped") await runner.start().catch(() => {});
    else if (runner.status === "starting") await runner.start().catch(() => {});
    return runner.snapshot();
  }

  getTranscript(id: TaskId): TranscriptSnapshot {
    return this.#runner(id).snapshot();
  }

  markTaskRead(id: TaskId): void {
    this.#runner(id).markRead();
  }

  sendPrompt(id: TaskId, input: PromptInput): Promise<void> {
    return this.#runner(id).sendPrompt(input);
  }

  removeQueuedMessage(id: TaskId, text: string, queue: "steering" | "followUp"): Promise<RestoredDraft | null> {
    return this.#runner(id).removeQueuedMessage(text, queue);
  }

  promoteQueuedMessage(id: TaskId, text: string): Promise<boolean> {
    return this.#runner(id).promoteQueuedMessage(text);
  }

  stopTask(id: TaskId): Promise<RestoredQueue> {
    return this.#runner(id).stop();
  }

  respondDialog(id: TaskId, dialogId: string, response: DialogResponse): Promise<void> {
    return this.#runner(id).respondDialog(dialogId, response);
  }

  renameTask(id: TaskId, title: string): Promise<void> {
    return this.#runner(id).rename(title);
  }

  /** 关掉进程并从侧栏移除；会话文件和 tasks.json 记录保留（resume() 能找回）。 */
  async archiveTask(id: TaskId): Promise<void> {
    const runner = this.#runner(id);
    await runner.dispose();
    await runner.setArchived(true);
    this.#runners.delete(id);
    this.#recyclableSince.delete(id);
    if (this.#foreground === id) this.#foreground = null;
    this.#deps.events.taskRemoved(id);
  }

  /** 出错后重新拉起。 */
  async restartTask(id: TaskId): Promise<void> {
    await this.#runner(id).start();
  }

  compactTask(id: TaskId): Promise<void> {
    return this.#runner(id).compact();
  }

  taskCwd(id: TaskId): string {
    return this.#runner(id).cwd;
  }

  listSlashCommands(id: TaskId): Promise<AvailableSlashCommand[]> {
    return this.#runner(id).listSlashCommands();
  }

  listTaskModels(id: TaskId): Promise<ModelOption[]> {
    return this.#runner(id).listModels();
  }

  setTaskModel(id: TaskId, model: ModelKey): Promise<void> {
    return this.#runner(id).setModel(model);
  }

  setTaskThinkingLevel(id: TaskId, level: ThinkingLevel): Promise<void> {
    return this.#runner(id).setThinkingLevel(level);
  }

  // ───── 上限和回收 ─────

  #liveRunners(except: TaskId): TaskRunner[] {
    return [...this.#runners.values()].filter(
      (runner) => runner.id !== except && (runner.hasProcess || runner.status === "starting"),
    );
  }

  async #acquireSlot(id: TaskId): Promise<void> {
    if (this.#shuttingDown) throw new Error("the app is shutting down");
    const soft = (await this.#deps.getSettings()).maxLiveProcesses;
    const live = this.#liveRunners(id);
    if (live.length >= soft) {
      const victim = live
        .filter((runner) => runner.recyclable && runner.id !== this.#foreground)
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
      if (victim) await this.#recycle(victim);
      else if (live.length >= soft * 2) throw new TooManyTasksError("too many tasks are running at the same time");
    }
  }

  async #recycle(runner: TaskRunner): Promise<void> {
    await runner.close();
    this.#recyclableSince.delete(runner.id);
    this.#trimSnapshots();
  }

  /** 已停止的任务最多保留 SNAPSHOT_LRU_SIZE 份对话快照，更久没用的释放，再打开时从会话文件恢复。 */
  #trimSnapshots(): void {
    const stopped = [...this.#runners.values()]
      .filter((runner) => !runner.hasProcess && runner.hasSnapshot)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    for (const runner of stopped.slice(SNAPSHOT_LRU_SIZE)) runner.releaseSnapshot();
  }

  /** 定时回收：可回收状态持续 IDLE_RECYCLE_MS 就关进程。`now` 由调用方传入，测试不依赖真实时钟。 */
  async sweep(now: number): Promise<void> {
    for (const runner of this.#runners.values()) {
      if (!runner.hasProcess || !runner.recyclable || runner.id === this.#foreground) {
        this.#recyclableSince.delete(runner.id);
        continue;
      }
      const since = this.#recyclableSince.get(runner.id) ?? now;
      this.#recyclableSince.set(runner.id, since);
      if (now - since >= IDLE_RECYCLE_MS) await this.#recycle(runner);
    }
  }

  /** 关所有子进程：并行 close，超时按进程树结束。before-quit 调用。 */
  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    clearInterval(this.#sweepTimer);
    await Promise.all([...this.#runners.values()].map((runner) => runner.close(SHUTDOWN_CLOSE_TIMEOUT_MS)));
    for (const runner of this.#runners.values()) await runner.dispose();
  }
}
