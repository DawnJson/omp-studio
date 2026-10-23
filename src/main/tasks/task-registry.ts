// 任务和项目的持久化：userData/tasks.json（应用自己的元数据，不写 ~/.omp；重命名、归档也存这里，决策 9）。
// 先写临时文件再改名；写盘串行化，避免两次保存交错。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelKey, Project, ProjectId, TaskId } from "../../shared/ipc.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { writeFileAtomic } from "./atomic-write.ts";

export interface TaskRecord {
  id: TaskId;
  projectId: ProjectId;
  /** 会话文件在第一条 assistant 消息之后才落盘；之前为 null。 */
  sessionFile: string | null;
  title: string;
  createdAt: number;
  /** 最后一次任务活动：用户发消息、一轮结束。只由这两处显式写入；改名、迁移引擎、存会话文件、归档等记账写入不碰它（侧栏按它排序、显示"N 分钟前"）。从历史会话建的任务取会话文件的修改时间。 */
  updatedAt: number;
  archived: boolean;
  model: ModelKey | null;
  thinkingLevel: ThinkingLevel | null;
  /** 任务的 worktree 根目录（omp 以它为 cwd）；没有 worktree 为 null。 */
  worktreePath: string | null;
  /** worktree 的分支（studio/<slug>）和创建时所在的基分支；合并回哪里以它为准。 */
  worktreeBranch: string | null;
  worktreeBase: string | null;
  /**
   * TSP 分叉出来的任务（TaskPool.forkTask）：第一次起进程时用 `omp --fork=<这个会话文件>`，omp 复制它建出自己的新会话文件；
   * 新文件的路径一落盘（TspRunner.#persistSessionFile）就记进 sessionFile 并清掉本字段，之后一律 `--resume`。没有则不写这个字段。
   */
  forkFrom?: string | null;
  /**
   * omp 里换过会话目录（`/move`、`/wt`，OSC 7）之后的当前目录；下次 `--resume` 从这里启动，文件面板、评审、终端等也用它（TspRunner.cwd）。
   * 没有或 null = 默认目录（`worktreePath ?? 项目目录`）。不写这个字段的记录行为不变。
   */
  cwd?: string | null;
}

interface TasksFile {
  version: 1;
  projects: Project[];
  tasks: TaskRecord[];
}

/** Windows 路径不区分大小写；比较用的键。 */
export function pathKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export class TaskRegistry {
  readonly #file: string;
  #data: TasksFile = { version: 1, projects: [], tasks: [] };
  #writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.#file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    // 文件损坏时抛错让问题被看见，而不是当作空表覆盖掉用户的任务列表。
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1)
      throw new Error(`${this.#file}: unsupported tasks.json format`);
    // 老版本写的记录：没有 worktree 字段的补 null；带 `engine` 字段的（rpc 引擎删除之前写的，`rpc` 或 `tsp`）去掉这个字段——
    // 现在只有 TSP 一种引擎，rpc 老任务沿用原来的 sessionFile，下次启动由 TspRunner 用 `--resume` 打开同一个会话。文件不在这里改写，下次保存时落盘。
    const tasks = (parsed as TasksFile).tasks.map(
      ({ engine: _engine, ...task }: TaskRecord & { engine?: unknown }) => ({
        ...task,
        worktreePath: task.worktreePath ?? null,
        worktreeBranch: task.worktreeBranch ?? null,
        worktreeBase: task.worktreeBase ?? null,
      }),
    );
    this.#data = { ...(parsed as TasksFile), tasks };
  }

  /** 保存当前内存里的状态；返回的 promise 在写盘完成后 resolve。 */
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.#data, null, 2);
    const run = this.#writing.then(() => writeFileAtomic(this.#file, snapshot, String(process.pid)));
    // 链上只保留"上一次写完了"，一次失败不连累后面的写入；这次的错误通过返回值交给调用方。
    this.#writing = run.catch(() => {});
    return run;
  }

  listProjects(): Project[] {
    return this.#data.projects;
  }

  findProject(id: ProjectId): Project | undefined {
    return this.#data.projects.find((project) => project.id === id);
  }

  findProjectByPath(dir: string): Project | undefined {
    const key = pathKey(dir);
    return this.#data.projects.find((project) => pathKey(project.path) === key);
  }

  /** 已有同路径项目就返回它。 */
  async addProject(dir: string): Promise<Project> {
    const existing = this.findProjectByPath(dir);
    if (existing) return existing;
    const resolved = path.resolve(dir);
    const project: Project = {
      id: randomUUID() as ProjectId,
      path: resolved,
      name: path.basename(resolved) || resolved,
    };
    this.#data = { ...this.#data, projects: [...this.#data.projects, project] };
    await this.save();
    return project;
  }

  async removeProject(id: ProjectId): Promise<void> {
    this.#data = { ...this.#data, projects: this.#data.projects.filter((project) => project.id !== id) };
    await this.save();
  }

  listTasks(): TaskRecord[] {
    return this.#data.tasks;
  }

  findTask(id: TaskId): TaskRecord | undefined {
    return this.#data.tasks.find((task) => task.id === id);
  }

  findTaskBySessionFile(sessionFile: string): TaskRecord | undefined {
    const key = pathKey(sessionFile);
    return this.#data.tasks.find((task) => task.sessionFile !== null && pathKey(task.sessionFile) === key);
  }

  async addTask(
    input: Omit<
      TaskRecord,
      "id" | "createdAt" | "updatedAt" | "archived" | "worktreePath" | "worktreeBranch" | "worktreeBase"
    > & {
      /** 默认现在；从历史会话建任务时传会话文件的修改时间。 */
      updatedAt?: number;
      worktree?: { path: string; branch: string; base: string };
    },
  ): Promise<TaskRecord> {
    const now = Date.now();
    const { worktree, updatedAt, ...fields } = input;
    const record: TaskRecord = {
      ...fields,
      id: randomUUID() as TaskId,
      createdAt: now,
      updatedAt: updatedAt ?? now,
      archived: false,
      worktreePath: worktree?.path ?? null,
      worktreeBranch: worktree?.branch ?? null,
      worktreeBase: worktree?.base ?? null,
    };
    this.#data = { ...this.#data, tasks: [...this.#data.tasks, record] };
    await this.save();
    return record;
  }

  /** 更新字段并写盘；不改 `updatedAt`（要改就在 patch 里显式给）。返回更新后的记录。 */
  async updateTask(id: TaskId, patch: Partial<Omit<TaskRecord, "id">>): Promise<TaskRecord> {
    const current = this.findTask(id);
    if (!current) throw new Error(`unknown task ${id}`);
    const next: TaskRecord = { ...current, ...patch };
    this.#data = { ...this.#data, tasks: this.#data.tasks.map((task) => (task.id === id ? next : task)) };
    await this.save();
    return next;
  }
}
