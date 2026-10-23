// 任务池：持有所有任务的运行时，管进程上限、空闲回收、快照淘汰、关闭。
// 规则见 docs/architecture/task-model.md（arch 2.3）：软上限默认 6，按最近使用回收可回收的空闲任务；
// 没有可回收的就超出软上限照起，到硬上限（软上限 × 2）才拒绝；可回收状态持续 15 分钟定时关闭。
import { stat } from "node:fs/promises";
import type {
  CreateTaskInput,
  ModelKey,
  ModelOption,
  Project,
  ProjectId,
  PromptInput,
  RestoredQueue,
  SessionTreeView,
  BranchTaskResult,
  ForkResult,
  StudioSettings,
  TaskId,
  TaskNotice,
  TaskState,
  TspBatch,
  TspSessionExtras,
  ContextReport,
  TspSubagentRecord,
  TspSnapshot,
} from "../../shared/ipc.ts";
import type { AvailableSlashCommand, GoalOp, ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { OmpLaunch } from "../omp/omp-connection.ts";
import type { BtwHistoryRecord, BtwUiEvent } from "../../shared/btw.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import { titleFromPrompt } from "./convert.ts";
import { stripIconGlyphs } from "../../shared/ui/clean-title.ts";
import {
  TooManyTasksError,
  TspRunner,
  type NewTaskDefaults,
  type TspRunnerHost,
  type TspSessionDeps,
} from "./tsp-runner.ts";
import type { TaskRecord, TaskRegistry } from "./task-registry.ts";
import { taskCommandText, type TaskCommand } from "../../shared/omp-output/index.ts";

export const IDLE_RECYCLE_MS = 15 * 60_000;
const SNAPSHOT_LRU_SIZE = 10;
const SHUTDOWN_CLOSE_TIMEOUT_MS = 5_000;
const SWEEP_INTERVAL_MS = 60_000;

interface PoolEvents {
  state(state: TaskState): void;
  notice(notice: TaskNotice): void;
  taskRemoved(id: TaskId): void;
  /** 旁路提问（`/btw`）的变化；不关心的调用方（多数测试）可以不给。 */
  btw?(taskId: TaskId, event: BtwUiEvent): void;
  /** 任务的节点树批次（16ms 合批）；不关心的调用方（多数测试）可以不给。 */
  tspBatch?(batch: TspBatch): void;
  /** omp 往它自己的输入框里写了 studio 没发的文字（Ctrl+R 选中的历史、`/annotate`、`/plan` 预填）：已清空 omp 那边，文字放进 studio 的输入框；多数测试不给。 */
  composerPrefill?(taskId: TaskId, text: string): void;
}

export interface WorktreeOps {
  create(project: Project): Promise<{ path: string; branch: string; base: string }>;
  remove(project: Project, worktreePath: string, branch: string): Promise<void>;
}

export interface PoolDeps {
  registry: TaskRegistry;
  getSettings(): Promise<StudioSettings>;
  events: PoolEvents;
  /** 没传时 `createTask({worktree: true})` 和 `discardWorktree` 直接报错；单元测试不需要 git。 */
  worktrees?: WorktreeOps;
  /** 归档任务、丢弃 worktree 之前调用并等待（不抛错）：用来结束任务名下的内置终端，Windows 上进程占着目录就删不掉。 */
  beforeTaskClose?(id: TaskId): Promise<void>;
  /** 分叉出的新任务的标题（原标题加“分叉”后缀）；没传时沿用原标题。空标题不会走到这里。 */
  forkTitle?(title: string): string;
  /** 上次读到的模型目录里的这一项（启动缓存）：任务进程起来之前，胶囊先显示它的名字和上下文窗口。 */
  knownModel?(key: ModelKey): ModelOption | null;
  /** 模型目录（服务进程的 get_available_models）：把 omp 的模型显示名换成模型键、给 listTaskModels；没传时列表为空。 */
  listModels?(): Promise<ModelOption[]>;
  /** omp 的命令列表：`cwd` 是任务目录（该目录的项目 rpc-ui，含项目 skill、自定义命令、扩展命令），`null` = 草稿页（服务进程）；没传时为空。 */
  listSlashCommands?(cwd: string | null): Promise<AvailableSlashCommand[]>;
  /** 导出 HTML：对会话文件跑 `omp --export <文件> <输出路径>`（omp/export-session.ts）；没传时不能导出。 */
  exportSession?(sessionFile: string, outputPath: string, cwd: string): Promise<void>;
  /** omp 对这个项目的新任务默认值（和草稿页同源）：输入框出现之前用它显示模型和思考强度；没传时不显示。 */
  newTaskDefaults?(project: Project): Promise<NewTaskDefaults>;
  /** 伪终端里的交互式 omp（TspSession）的依赖。 */
  tsp: {
    buildLaunch(record: TaskRecord, project: Project): Promise<OmpLaunch>;
    session: TspSessionDeps;
  };
}

export interface ResumeInput {
  sessionFile: string;
  cwd: string;
  projectId: ProjectId;
  /** null 时取会话里第一条用户消息的第一行（调用方给不出时留空，由首次打开后的标题回填）。 */
  title: string | null;
  /** 会话文件的修改时间：新建的任务以它作为最后活动时间（点开历史会话不算活动）。 */
  modifiedAt: number;
}

export class TaskPool {
  readonly #deps: PoolDeps;
  readonly #runners = new Map<TaskId, TspRunner>();
  readonly #recyclableSince = new Map<TaskId, number>();
  #foreground: TaskId | null = null;
  #sweepTimer: NodeJS.Timeout | undefined;
  #shuttingDown = false;
  readonly #host: TspRunnerHost;

  constructor(deps: PoolDeps) {
    this.#deps = deps;
    const tsp = deps.tsp;
    this.#host = {
      buildLaunch: (record, project) => tsp.buildLaunch(record, project),
      persist: (id, patch) => deps.registry.updateTask(id, patch),
      isForeground: (id) => this.#foreground === id,
      acquireSlot: (id) => this.#acquireSlot(id),
      onState: (state) => deps.events.state(state),
      onTspBatch: (batch) => deps.events.tspBatch?.(batch),
      onBtw: (taskId, event) => deps.events.btw?.(taskId, event),
      onComposerPrefill: (taskId, text) => deps.events.composerPrefill?.(taskId, text),
      onNotice: (notice) => deps.events.notice(notice),
      session: tsp.session,
      knownModel: (key) => deps.knownModel?.(key) ?? null,
      ...(deps.listModels && { listModels: () => deps.listModels!() }),
      ...(deps.newTaskDefaults && { newTaskDefaults: (project: Project) => deps.newTaskDefaults!(project) }),
      ...(deps.listSlashCommands && { listSlashCommands: (cwd: string) => deps.listSlashCommands!(cwd) }),
      ...(deps.exportSession && {
        exportSession: (sessionFile: string, outputPath: string, cwd: string) =>
          deps.exportSession!(sessionFile, outputPath, cwd),
      }),
    };
  }

  /** 载入 tasks.json，为未归档的任务建（还没有进程的）运行时，并开始定时回收。 */
  async init(): Promise<void> {
    await this.#deps.registry.load();
    for (const record of this.#deps.registry.listTasks()) {
      if (!record.archived) this.#adopt(record);
    }
    this.#sweepTimer = setInterval(() => void this.sweep(Date.now()), SWEEP_INTERVAL_MS);
    this.#sweepTimer.unref();
  }

  #adopt(record: TaskRecord): TspRunner {
    const project = this.#deps.registry.findProject(record.projectId);
    if (!project) throw new Error(`task ${record.id} refers to unknown project ${record.projectId}`);
    const runner = new TspRunner(record, project, this.#host);
    this.#runners.set(record.id, runner);
    return runner;
  }

  #runner(id: TaskId): TspRunner {
    const runner = this.#runners.get(id);
    if (!runner) throw new Error(`unknown task ${id}`);
    return runner;
  }

  // ───── 项目 ─────

  listProjects(): Project[] {
    return this.#deps.registry.listProjects();
  }

  /** 项目目录；项目不存在就抛错。IPC 只传 projectId，目录一律取自主进程的记录。 */
  projectPath(projectId: ProjectId): string {
    const project = this.#deps.registry.findProject(projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    return project.path;
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

  /** 任务的会话文件（含已归档的任务）；还没有会话文件时为 null，任务不存在就抛错。 */
  sessionFileOf(taskId: TaskId): string | null {
    const record = this.#deps.registry.findTask(taskId);
    if (!record) throw new Error("任务不存在");
    return record.sessionFile;
  }

  // ───── 任务 ─────

  listTasks(): TaskState[] {
    return [...this.#runners.values()].map((runner) => runner.state);
  }

  async createTask(input: CreateTaskInput): Promise<TaskState> {
    const project = this.#deps.registry.findProject(input.projectId);
    if (!project) throw new Error(`unknown project ${input.projectId}`);
    // worktree 先建好再落记录：建失败（不是仓库、setup 脚本失败）时没有半成品任务。
    const worktree = input.worktree === true ? await this.#worktrees().create(project) : undefined;
    // 草稿里没选（"用于此任务"）的项不传：omp 按自己的配置（modelRoles.default、defaultThinkingLevel）选（设计原则 7）；
    // 选了的进任务记录，起进程时成为 `--model` / `--thinking`，只对这个会话生效。
    const record = await this.#deps.registry.addTask({
      projectId: project.id,
      sessionFile: null,
      title: "",
      model: input.model ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      ...(worktree && { worktree }),
    });
    const runner = this.#adopt(record);
    this.#startInBackground(runner);
    return runner.state;
  }

  /** 启动失败时状态已是 error 并已推送；这里不重复抛出（没有调用方在等）。 */
  #startInBackground(runner: TspRunner): void {
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
      const revived = await this.#deps.registry.updateTask(existing.id, {
        archived: false,
        ...(!this.#deps.registry.findProject(existing.projectId) && { projectId: project.id }),
      });
      const runner = this.#adopt(revived);
      this.#deps.events.state(runner.state);
      return runner.state;
    }
    await stat(project.path); // cwd 已不存在时报错，不替用户"迁移会话"（arch 1.6）
    const record = await this.#deps.registry.addTask({
      projectId: project.id,
      sessionFile: input.sessionFile,
      // 终端里 omp 起的会话标题带图标字形（私用区字符），存进任务前去掉。
      title: input.title === null ? "" : titleFromPrompt(stripIconGlyphs(input.title)) || stripIconGlyphs(input.title),
      model: null,
      thinkingLevel: null,
      updatedAt: input.modifiedAt,
    });
    const runner = this.#adopt(record);
    this.#startInBackground(runner);
    return runner.state;
  }

  /** 切到这个任务：需要时拉起 omp 并恢复会话，并清除 unread。启动失败不抛，状态里有 error。 */
  async openTask(id: TaskId): Promise<void> {
    const runner = this.#runner(id);
    this.#foreground = id;
    runner.markRead();
    if (runner.status === "stopped" || runner.status === "starting") await runner.start().catch(() => {});
  }

  /** 任务当前的节点树和序号（不拉起进程）。 */
  getTspSnapshot(id: TaskId): TspSnapshot {
    return this.#runner(id).tspSnapshot();
  }

  /** 任务已发出的最后一条 TSP 消息的序号（见 TspRunner.tspSeq）。 */
  getTspSeq(id: TaskId): number {
    return this.#runner(id).tspSeq();
  }

  /** 用量脚注和空闲回顾（omp 恢复会话时不重发）；读不到时为空。 */
  getTspSessionExtras(id: TaskId): Promise<TspSessionExtras> {
    return this.#runner(id).sessionExtras();
  }

  /** omp 现算的上下文构成（TspRunner.readContext）；读不到为 null。 */
  readTspContext(id: TaskId): Promise<ContextReport | null> {
    return this.#runner(id).readContext();
  }

  sendTspEvent(id: TaskId, event: TspEvent): void {
    this.#runner(id).sendTspEvent(event);
  }

  sendTspKeys(id: TaskId, data: string): void {
    this.#runner(id).sendTspKeys(data);
  }

  resizeTsp(id: TaskId, cols: number): void {
    this.#runner(id).resizeTsp(cols);
  }

  /** 深浅主题或减少动效变了（runtime.ts 订阅 nativeTheme 和设置）：通知所有运行中的 TSP 会话。 */
  setAppearance(next: { dark: boolean; reduceMotion: boolean }): void {
    for (const runner of this.#runners.values()) runner.setAppearance(next);
  }

  // 子代理面板（S1）：读会话文件，插话 / 结束 / 恢复由主进程在后台驱动 Agent Hub。
  getTspSubagentRecord(id: TaskId, name: string): Promise<TspSubagentRecord> {
    return this.#runner(id).subagentRecord(name);
  }

  focusTspSubagent(id: TaskId, name: string): Promise<void> {
    return this.#runner(id).focusSubagent(name);
  }

  steerTspSubagent(id: TaskId, name: string, text: string): Promise<void> {
    return this.#runner(id).steerSubagent(name, text);
  }

  killTspSubagent(id: TaskId, name: string): Promise<void> {
    return this.#runner(id).killSubagent(name);
  }

  reviveTspSubagent(id: TaskId, name: string): Promise<void> {
    return this.#runner(id).reviveSubagent(name);
  }

  sendPrompt(id: TaskId, input: PromptInput): Promise<void> {
    return this.#runner(id).sendPrompt(input);
  }

  askBtw(id: TaskId, question: string, recordId?: string): Promise<string> {
    return this.#runner(id).askBtw(question, recordId);
  }

  cancelBtw(id: TaskId, recordId?: string): Promise<boolean> {
    return this.#runner(id).cancelBtw(recordId);
  }

  getBtw(id: TaskId): Promise<BtwHistoryRecord[]> {
    return this.#runner(id).getBtw();
  }

  stopTask(id: TaskId): Promise<RestoredQueue> {
    return this.#runner(id).stop();
  }

  renameTask(id: TaskId, title: string): Promise<void> {
    return this.#runner(id).rename(title);
  }

  /** 关掉进程并从侧栏移除；会话文件和 tasks.json 记录保留（resume() 能找回）。 */
  async archiveTask(id: TaskId): Promise<void> {
    const runner = this.#runner(id);
    await this.#deps.beforeTaskClose?.(id);
    await runner.dispose();
    await runner.setArchived(true);
    this.#runners.delete(id);
    this.#recyclableSince.delete(id);
    if (this.#foreground === id) this.#foreground = null;
    this.#deps.events.taskRemoved(id);
  }

  /** 压缩上下文：发 `/compact`，等 omp 画出压缩分隔（成功）或 "Error: Compaction failed: …"（失败，原文抛出），见 `TspRunner.compact`。 */
  async compactTask(id: TaskId): Promise<void> {
    await this.#runner(id).compact();
  }

  /** 重开会话（`TspRunner.restart`）：关进程再 `--resume`；任务忙时拒绝。 */
  async restartTask(id: TaskId): Promise<void> {
    await this.#runner(id).restart();
  }

  /**
   * 会话级斜杠命令（`TaskCommand` → `/命令`，渲染进程从不传文本）。工作区目录三件走 `runWorkspaceDirsCommand`（要更新状态）；
   * `compact` 走 `compactTask`（没有 toast，看压缩分隔）；`jobsKill`、`retry` 成功时 omp 没有 toast，走 `runQuietCommand`；
   * 其余等 omp 的状态 toast。
   */
  async runTaskCommand(id: TaskId, cmd: TaskCommand): Promise<{ text: string }> {
    if (cmd.kind === "dirs" || cmd.kind === "addDir" || cmd.kind === "removeDir")
      return { text: await this.runWorkspaceDirsCommand(id, cmd) };
    if (cmd.kind === "compact") {
      await this.compactTask(id);
      return { text: "" };
    }
    // 交接和压缩一样没有 toast，看压缩分隔；待办成功是 toast、失败是 `Error:` 行（runTodoCommand）。
    if (cmd.kind === "handoff") {
      await this.#runner(id).handoff();
      return { text: "" };
    }
    const runner = this.#runner(id);
    if (cmd.kind === "todo") return { text: await runner.runTodoCommand(taskCommandText(cmd)) };
    // 模式命令是切换：发之前看当前模式、发出后看模式有没有变（runModeCommand）；`kind` 就是 ModeOp。
    if (
      cmd.kind === "plan" ||
      cmd.kind === "planReview" ||
      cmd.kind === "vibe" ||
      cmd.kind === "loopStart" ||
      cmd.kind === "loopStop"
    )
      return { text: await runner.runModeCommand(cmd.kind, taskCommandText(cmd)) };
    const text = taskCommandText(cmd);
    const quiet = cmd.kind === "jobsKill" || cmd.kind === "retry";
    return { text: await (quiet ? runner.runQuietCommand(text) : runner.runSessionCommand(text)) };
  }

  /** 导出对话框的默认文件名要用：任务标题（还没有标题时为空串）。任务不存在时抛错。 */
  taskTitle(id: TaskId): string {
    return this.#runner(id).state.title;
  }

  /** 导出成 HTML 写到 `outputPath`（绝对路径，由调用方经保存对话框得到）；返回写到的路径。对会话文件跑 `omp --export`。 */
  exportTaskHtml(id: TaskId, outputPath: string): Promise<string> {
    return this.#runner(id).exportHtml(outputPath);
  }

  getSessionTree(id: TaskId): Promise<SessionTreeView> {
    return this.#runner(id).getSessionTree();
  }

  /**
   * 从一条用户消息分叉出新任务（docs/architecture/session-tree.md）：`entryId` 是会话条目 id（会话树面板的节点；null = 当前分支最后一条用户消息）。
   * 新任务同项目、同 cwd（worktree 任务的分叉记同一个 worktree，由 discardWorktree 保证不被一方删掉）、同模型；第一次起进程用
   * `omp --fork=<原会话文件>`（omp 自己复制出新会话文件，我们不写会话文件），起来后在新进程里用 `/tree` 回到那条消息之前（TspRunner.rewindTo）。
   * 原任务不动。回溯失败时新任务保留（它是原会话的完整副本），错误照抛。
   */
  async forkTask(id: TaskId, entryId: string | null): Promise<ForkResult> {
    const source = this.#runner(id);
    const { sourceFile, entryId: target, target: known } = await source.prepareFork(entryId);
    const { projectId, title, model, thinkingLevel, worktreePath, worktreeBranch, worktreeBase, cwd } = source.record;
    const record = await this.#deps.registry.addTask({
      projectId,
      sessionFile: null,
      forkFrom: sourceFile,
      title: title === "" ? title : (this.#deps.forkTitle?.(title) ?? title),
      model,
      thinkingLevel,
      // omp 里 `/move` 过的会话绑在新目录上，分叉要在同一目录起。
      ...(cwd != null && { cwd }),
      ...(worktreePath !== null &&
        worktreeBranch !== null &&
        worktreeBase !== null && { worktree: { path: worktreePath, branch: worktreeBranch, base: worktreeBase } }),
    });
    const forked = this.#adopt(record);
    this.#deps.events.state(forked.state);
    await forked.start();
    const { text } = await forked.rewindTo(target, known);
    return { task: forked.state, text };
  }

  async branchTask(id: TaskId, entryId: string, summarize = false): Promise<BranchTaskResult> {
    return this.#runner(id).rewindTo(entryId, undefined, summarize);
  }

  /** 给会话树里的条目打标签（`label` 为 null / 空 = 清除），由 omp 的 `/tree` 选择器完成。 */
  async labelTreeEntry(id: TaskId, entryId: string, label: string | null): Promise<void> {
    return this.#runner(id).labelEntry(entryId, label);
  }

  taskGoal(id: TaskId, op: GoalOp, objective?: string): Promise<TaskState["goal"]> {
    return this.#runner(id).goal(op, objective);
  }

  /** 任务现在的工作目录：omp 里 `/move` 过的目录 > worktree 根 > 项目路径（TspRunner.cwd）。 */
  taskCwd(id: TaskId): string {
    return this.#runner(id).cwd;
  }

  /** omp 标题里的 PR 号（当前分支有 PR）；没有为 null。 */
  taskPullRequest(id: TaskId): number | null {
    return this.#runner(id).prNumber;
  }

  // ───── 工作区目录（`/add-dir`；S7）─────

  /** 任务会话的额外工作区目录（omp 最近一次报的列表）；文件面板按下标选根时校验用。 */
  taskWorkspaceDirs(id: TaskId): readonly string[] {
    return this.#runner(id).workspaceDirs;
  }

  /**
   * 在任务自己的 omp 里跑 `/dirs`、`/add-dir`、`/remove-dir` 并用输出更新 `TaskState.workspaceDirs`；返回 omp 原文。
   * omp 拒绝（目录不存在、已在工作区…）或输出认不出来时以原文 reject，列表不变。通用的 `runTaskCommand` 遇到这三个 kind 也走这里。
   */
  async runWorkspaceDirsCommand(
    id: TaskId,
    cmd: Extract<TaskCommand, { kind: "dirs" | "addDir" | "removeDir" }>,
  ): Promise<string> {
    const runner = this.#runner(id);
    const text = await runner.runSessionCommand(taskCommandText(cmd));
    runner.applyWorkspaceDirsOutput(text);
    return text;
  }

  /** 面板打开时对账：只问有进程的任务（没有进程时 omp 那边的列表本来就是空的）。 */
  async refreshWorkspaceDirs(id: TaskId): Promise<void> {
    if (!this.#runner(id).hasProcess) return;
    await this.runWorkspaceDirsCommand(id, { kind: "dirs" });
  }

  /** 按下标（1…n，同文件面板的根下标）移除额外目录：路径取自主进程记的列表。 */
  removeWorkspaceDirAt(id: TaskId, root: number): Promise<string> {
    const dir = this.taskWorkspaceDirs(id)[root - 1];
    if (dir === undefined) return Promise.reject(new Error("unknown workspace directory"));
    return this.runWorkspaceDirsCommand(id, { kind: "removeDir", path: dir });
  }

  /** git 相关 IPC 要的上下文：项目路径（主仓库）、任务 cwd 和 worktree 记录。 */
  taskGitContext(id: TaskId): {
    projectPath: string;
    cwd: string;
    worktree: { path: string; branch: string; base: string } | null;
  } {
    const runner = this.#runner(id);
    const { worktreePath, worktreeBranch, worktreeBase } = runner.record;
    const project = this.#deps.registry.findProject(runner.record.projectId);
    if (!project) throw new Error(`task ${id} refers to unknown project`);
    return {
      projectPath: project.path,
      cwd: runner.cwd,
      worktree:
        worktreePath !== null && worktreeBranch !== null && worktreeBase !== null
          ? { path: worktreePath, branch: worktreeBranch, base: worktreeBase }
          : null,
    };
  }

  /** 所有任务记录（含已归档）引用的 worktree 路径：清理无主 worktree 时这些不能动。 */
  referencedWorktreePaths(projectId: ProjectId): string[] {
    return this.#deps.registry
      .listTasks()
      .filter((task) => task.projectId === projectId && task.worktreePath !== null)
      .map((task) => task.worktreePath as string);
  }

  /** 丢弃任务的 worktree：先关进程（Windows 上进程占着目录删不掉），移除 worktree 和分支，再把任务归档。 */
  async discardWorktree(id: TaskId): Promise<void> {
    const runner = this.#runner(id);
    const { worktreePath, worktreeBranch } = runner.record;
    if (worktreePath === null || worktreeBranch === null) throw new Error("the task has no worktree");
    // 分叉出来的任务共用这个 worktree（omp 会话绑 cwd，分叉必须在同一目录恢复）：还有别的任务（含已归档的：
    // 归档不删 worktree，恢复后还要用它，removeWorktree 会连分支一起删）在用就不能删。
    if (this.#deps.registry.listTasks().some((task) => task.id !== id && task.worktreePath === worktreePath))
      throw new Error("the worktree is shared with another task");
    const project = this.#deps.registry.findProject(runner.record.projectId);
    if (!project) throw new Error(`task ${id} refers to unknown project`);
    await this.#deps.beforeTaskClose?.(id);
    await runner.close();
    await this.#worktrees().remove(project, worktreePath, worktreeBranch);
    // cwd 也清掉：它可能在被删的 worktree 里（OSC 7 记的是 omp 当前目录）。
    await this.#deps.registry.updateTask(id, {
      worktreePath: null,
      worktreeBranch: null,
      worktreeBase: null,
      cwd: null,
    });
    await this.archiveTask(id);
  }

  #worktrees(): WorktreeOps {
    const ops = this.#deps.worktrees;
    if (!ops) throw new Error("worktrees are not available");
    return ops;
  }

  listSlashCommands(id: TaskId): Promise<AvailableSlashCommand[]> {
    return this.#runner(id).listSlashCommands();
  }

  /** 草稿页（还没有任务，没有任务目录）的命令列表：服务进程的 get_available_commands；没接服务进程时 []。 */
  async listDraftSlashCommands(): Promise<AvailableSlashCommand[]> {
    return (await this.#deps.listSlashCommands?.(null)) ?? [];
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

  setTaskFastMode(id: TaskId, enabled: boolean): Promise<void> {
    return this.#runner(id).setFastMode(enabled);
  }

  setTaskSlowMode(id: TaskId, enabled: boolean): Promise<void> {
    return this.#runner(id).setSlowMode(enabled);
  }

  // ───── 上限和回收 ─────

  #liveRunners(except: TaskId): TspRunner[] {
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

  async #recycle(runner: TspRunner): Promise<void> {
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
