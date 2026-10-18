// 内置终端管理：每个任务至多一个 pty，重新打开时复用还活着的那个。不 import electron / node-pty，
// 外部能力（起 pty、任务目录、Job Object、事件出口）都从 deps 进来，单元测试用假 pty。
// 生命周期和 cwd 规则见 docs/architecture/terminal.md。
import type { TaskId, TerminalOpenResult } from "../../shared/ipc.ts";
import { Backlog } from "./backlog.ts";
import { OutputBatcher } from "./output-batcher.ts";
import type { ShellChoice } from "./shell.ts";

export const BACKLOG_CHARS = 256 * 1024;
export const BATCH_INTERVAL_MS = 16;
export const BATCH_MAX_CHARS = 64 * 1024;

export interface PtyLike {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface TerminalDeps {
  /** 任务的工作目录（worktree 根或项目目录）；任务不存在时抛错。 */
  taskCwd(taskId: TaskId): string;
  directoryExists(dir: string): Promise<boolean>;
  resolveShell(): ShellChoice;
  buildEnv(): Record<string, string>;
  spawn(shell: ShellChoice, options: SpawnOptions): Promise<PtyLike>;
  /** 结束 pid 和它的所有后代（Windows 的 taskkill /T；其他平台靠 pty.kill 的 SIGHUP，什么也不做）。 */
  killTree(pid: number): Promise<void>;
  /** 把 shell 放进应用 Job Object；失败由调用方记日志，终端照常可用（退出时仍由 closeAll 结束）。 */
  assignJob(pid: number): void;
  emitData(taskId: TaskId, data: string): void;
  emitExit(taskId: TaskId, exitCode: number): void;
  onError(message: string, error: unknown): void;
}

interface Entry {
  pty: PtyLike;
  shell: ShellChoice;
  cwd: string;
  backlog: Backlog;
  batcher: OutputBatcher;
  subscriptions: { dispose(): void }[];
}

/** 任务目录已经不存在（worktree 被删等）：不替用户换目录，直接拒绝。 */
export class TerminalCwdMissingError extends Error {
  override name = "TerminalCwdMissingError";
  constructor() {
    super("the task directory no longer exists, so a terminal cannot be opened there");
  }
}

export class TerminalManager {
  readonly #deps: TerminalDeps;
  readonly #entries = new Map<TaskId, Entry>();
  /** 同一任务并发的 open 共用一次 spawn（面板快速开关、重载时会发生）。 */
  readonly #opening = new Map<TaskId, Promise<TerminalOpenResult>>();

  constructor(deps: TerminalDeps) {
    this.#deps = deps;
  }

  has(taskId: TaskId): boolean {
    return this.#entries.has(taskId);
  }

  open(taskId: TaskId, cols: number, rows: number): Promise<TerminalOpenResult> {
    const pending = this.#opening.get(taskId);
    if (pending) return pending;
    const promise = this.#open(taskId, cols, rows).finally(() => this.#opening.delete(taskId));
    this.#opening.set(taskId, promise);
    return promise;
  }

  async #open(taskId: TaskId, cols: number, rows: number): Promise<TerminalOpenResult> {
    const existing = this.#entries.get(taskId);
    if (existing) {
      // 还没发出去的输出已经在 backlog 里，丢掉它，否则界面会收到两遍。
      existing.batcher.discard();
      this.#resize(existing, cols, rows);
      return { cwd: existing.cwd, shell: existing.shell.name, reopened: true, backlog: existing.backlog.snapshot() };
    }
    const cwd = this.#deps.taskCwd(taskId);
    if (!(await this.#deps.directoryExists(cwd))) throw new TerminalCwdMissingError();
    const shell = this.#deps.resolveShell();
    const pty = await this.#deps.spawn(shell, { cwd, env: this.#deps.buildEnv(), cols, rows });
    // 同一个同步段里放进 Job 并挂监听：不漏掉 shell 启动时的输出。
    try {
      this.#deps.assignJob(pty.pid);
    } catch (error) {
      this.#deps.onError("terminal: could not assign the shell to the job object", error);
    }
    const entry: Entry = {
      pty,
      shell,
      cwd,
      backlog: new Backlog(BACKLOG_CHARS),
      batcher: new OutputBatcher((data) => this.#deps.emitData(taskId, data), {
        intervalMs: BATCH_INTERVAL_MS,
        maxChars: BATCH_MAX_CHARS,
      }),
      subscriptions: [],
    };
    entry.subscriptions.push(
      pty.onData((data) => {
        entry.backlog.append(data);
        entry.batcher.push(data);
      }),
      pty.onExit(({ exitCode }) => {
        // 只处理还在表里的：主动 close 时已经摘掉监听并从表里删了，不会走到这里。
        if (this.#entries.get(taskId) !== entry) return;
        entry.batcher.flush();
        this.#detach(taskId, entry);
        this.#deps.emitExit(taskId, exitCode);
      }),
    );
    this.#entries.set(taskId, entry);
    return { cwd, shell: shell.name, reopened: false, backlog: "" };
  }

  write(taskId: TaskId, data: string): void {
    const entry = this.#entries.get(taskId);
    if (!entry) return;
    try {
      entry.pty.write(data);
    } catch (error) {
      this.#deps.onError("terminal: write failed", error);
    }
  }

  resize(taskId: TaskId, cols: number, rows: number): void {
    const entry = this.#entries.get(taskId);
    if (entry) this.#resize(entry, cols, rows);
  }

  #resize(entry: Entry, cols: number, rows: number): void {
    try {
      entry.pty.resize(cols, rows);
    } catch (error) {
      // shell 刚好退出的瞬间 node-pty 会抛错；onExit 随后就到，这里只记一笔。
      this.#deps.onError("terminal: resize failed", error);
    }
  }

  /**
   * 结束任务的终端（整棵进程树）；不发 terminalExit（调用方就是发起者，已经知道）。
   * 状态和监听同步摘掉；返回的 promise 在进程树被结束之后才 resolve：Windows 上进程占着目录，
   * 删 worktree 之前必须等它。
   */
  close(taskId: TaskId): Promise<void> {
    // 正在起：等它起好再结束，否则这个终端会成为没人管的孤儿。
    const pending = this.#opening.get(taskId);
    if (pending)
      return pending.then(
        () => this.close(taskId),
        () => undefined,
      );
    const entry = this.#entries.get(taskId);
    if (!entry) return Promise.resolve();
    this.#detach(taskId, entry);
    entry.batcher.discard();
    return this.#kill(entry);
  }

  async #kill(entry: Entry): Promise<void> {
    // 先杀整棵树再关 pty：shell 先死的话子进程被重新挂靠，按父子关系就找不到它们了。
    try {
      await this.#deps.killTree(entry.pty.pid);
    } catch (error) {
      this.#deps.onError("terminal: killing the process tree failed", error);
    }
    try {
      entry.pty.kill();
    } catch (error) {
      // 树已经杀掉时 node-pty 可能报进程不存在。
      this.#deps.onError("terminal: kill failed", error);
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.#entries.keys(), ...this.#opening.keys()];
    await Promise.all(ids.map((taskId) => this.close(taskId)));
  }

  #detach(taskId: TaskId, entry: Entry): void {
    for (const subscription of entry.subscriptions) subscription.dispose();
    entry.subscriptions = [];
    if (this.#entries.get(taskId) === entry) this.#entries.delete(taskId);
  }
}
