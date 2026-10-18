// 任务和项目的持久化：userData/tasks.json（应用自己的元数据，不写 ~/.omp；重命名、归档也存这里，决策 9）。
// 先写临时文件再改名；写盘串行化，避免两次保存交错。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApprovalMode, ModelKey, Project, ProjectId, TaskId } from "../../shared/ipc.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { writeFileAtomic } from "./atomic-write.ts";

export interface TaskRecord {
  id: TaskId;
  projectId: ProjectId;
  /** 会话文件在第一条 assistant 消息之后才落盘；之前为 null。 */
  sessionFile: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  model: ModelKey | null;
  thinkingLevel: ThinkingLevel | null;
  /** 进程启动时固定（决策 2）。null = 不传 --approval-mode，跟随 omp 配置。 */
  approvalMode: ApprovalMode | null;
  /** 阶段 4 的 worktree 预留，第一版恒为 null。 */
  worktreePath: string | null;
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
    this.#data = parsed as TasksFile;
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
    input: Omit<TaskRecord, "id" | "createdAt" | "updatedAt" | "archived" | "worktreePath">,
  ): Promise<TaskRecord> {
    const now = Date.now();
    const record: TaskRecord = {
      ...input,
      id: randomUUID() as TaskId,
      createdAt: now,
      updatedAt: now,
      archived: false,
      worktreePath: null,
    };
    this.#data = { ...this.#data, tasks: [...this.#data.tasks, record] };
    await this.save();
    return record;
  }

  /** 更新字段并写盘；`updatedAt` 自动刷新。返回更新后的记录。 */
  async updateTask(id: TaskId, patch: Partial<Omit<TaskRecord, "id">>): Promise<TaskRecord> {
    const current = this.findTask(id);
    if (!current) throw new Error(`unknown task ${id}`);
    const next: TaskRecord = { ...current, ...patch, updatedAt: Date.now() };
    this.#data = { ...this.#data, tasks: this.#data.tasks.map((task) => (task.id === id ? next : task)) };
    await this.save();
    return next;
  }
}
