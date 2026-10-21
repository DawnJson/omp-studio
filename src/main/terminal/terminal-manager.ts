// 内置终端管理：每个键（任务 id，或新任务草稿的键）至多一个 pty，重新打开时复用还活着的那个。不 import electron / node-pty，
// 外部能力（起 pty、终端目录、Job Object、事件出口）都从 deps 进来，单元测试用假 pty。
// 生命周期和 cwd 规则见 docs/architecture/terminal.md。
import type { DraftKey, TaskId, TerminalKey, TerminalOpenResult } from "../../shared/ipc.ts";
import { withPtyLock } from "../platform/pty-lock.ts";
import { Backlog } from "./backlog.ts";
import { OutputBatcher } from "./output-batcher.ts";
import type { ShellChoice } from "./shell.ts";

const BACKLOG_CHARS = 256 * 1024;
const BATCH_INTERVAL_MS = 16;
const BATCH_MAX_CHARS = 64 * 1024;
/** taskkill 之后等退出事件多久；到点还没退出才 `pty.kill()`。 */
const KILL_GRACE_MS = 2_000;

export interface PtyLike {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface TerminalDeps {
  /** 终端的工作目录：任务的有效目录（worktree 根或项目目录），或草稿的项目目录 / chats 目录；任务或项目不存在时抛错。 */
  terminalCwd(key: TerminalKey): Promise<string>;
  directoryExists(dir: string): Promise<boolean>;
  resolveShell(): ShellChoice;
  buildEnv(): Record<string, string>;
  spawn(shell: ShellChoice, options: SpawnOptions): Promise<PtyLike>;
  /** 结束 pid 和它的所有后代（Windows 的 taskkill /T；其他平台靠 pty.kill 的 SIGHUP，什么也不做）。 */
  killTree(pid: number): Promise<void>;
  /**
   * 把 shell 放进它自己的 KILL_ON_JOB_CLOSE Job Object（主进程被强杀时由系统回收整棵树），返回释放函数（关句柄）。
   * 放进去失败由调用方记日志，终端照常可用（正常退出仍由 closeAll 结束）。
   */
  assignJob(pid: number): () => void;
  emitData(key: TerminalKey, data: string): void;
  emitExit(key: TerminalKey, exitCode: number): void;
  onError(message: string, error: unknown): void;
}

interface Entry {
  /** 当前的键：草稿的终端交给任务后会变，事件出口读这个，不捕获打开时的键。 */
  key: TerminalKey;
  pty: PtyLike;
  shell: ShellChoice;
  cwd: string;
  backlog: Backlog;
  batcher: OutputBatcher;
  subscriptions: { dispose(): void }[];
  /** 关 shell 的 Job 句柄；没放进 Job 时是空操作。 */
  releaseJob: () => void;
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
  readonly #entries = new Map<TerminalKey, Entry>();
  /** 同一个键并发的 open 共用一次 spawn（面板快速开关、重载时会发生）。 */
  readonly #opening = new Map<TerminalKey, Promise<TerminalOpenResult>>();

  constructor(deps: TerminalDeps) {
    this.#deps = deps;
  }

  has(key: TerminalKey): boolean {
    return this.#entries.has(key);
  }

  open(key: TerminalKey, cols: number, rows: number): Promise<TerminalOpenResult> {
    const pending = this.#opening.get(key);
    if (pending) return pending;
    const promise = this.#open(key, cols, rows).finally(() => this.#opening.delete(key));
    this.#opening.set(key, promise);
    return promise;
  }

  async #open(key: TerminalKey, cols: number, rows: number): Promise<TerminalOpenResult> {
    const existing = this.#entries.get(key);
    if (existing) {
      // 还没发出去的输出已经在 backlog 里，丢掉它，否则界面会收到两遍。
      existing.batcher.discard();
      this.#resize(existing, cols, rows);
      return { cwd: existing.cwd, shell: existing.shell.name, reopened: true, backlog: existing.backlog.snapshot() };
    }
    const cwd = await this.#deps.terminalCwd(key);
    if (!(await this.#deps.directoryExists(cwd))) throw new TerminalCwdMissingError();
    const shell = this.#deps.resolveShell();
    const pty = await this.#deps.spawn(shell, { cwd, env: this.#deps.buildEnv(), cols, rows });
    // 同一个同步段里放进 Job 并挂监听：不漏掉 shell 启动时的输出。
    let releaseJob = () => {};
    try {
      releaseJob = this.#deps.assignJob(pty.pid);
    } catch (error) {
      this.#deps.onError("terminal: could not assign the shell to the job object", error);
    }
    const entry: Entry = {
      key,
      pty,
      shell,
      cwd,
      backlog: new Backlog(BACKLOG_CHARS),
      batcher: new OutputBatcher((data) => this.#deps.emitData(entry.key, data), {
        intervalMs: BATCH_INTERVAL_MS,
        maxChars: BATCH_MAX_CHARS,
      }),
      subscriptions: [],
      releaseJob,
    };
    entry.subscriptions.push(
      pty.onData((data) => {
        entry.backlog.append(data);
        entry.batcher.push(data);
      }),
      pty.onExit(({ exitCode }) => {
        // 只处理还在表里的：主动 close 时已经摘掉监听并从表里删了，不会走到这里。
        if (this.#entries.get(entry.key) !== entry) return;
        entry.batcher.flush();
        this.#detach(entry);
        entry.releaseJob();
        this.#deps.emitExit(entry.key, exitCode);
      }),
    );
    this.#entries.set(key, entry);
    return { cwd, shell: shell.name, reopened: false, backlog: "" };
  }

  /**
   * 草稿建出任务后把草稿的终端交给任务：同一个 shell、同一份 backlog，之后的事件带新的键。
   * 草稿没有终端、任务已经有终端时什么也不动，返回 false（调用方再决定要不要关草稿的）。
   * 草稿的终端还在起（open 在途）时先等它起好。
   */
  async rekey(from: DraftKey, to: TaskId): Promise<boolean> {
    const pending = this.#opening.get(from);
    if (pending) await pending.catch(() => undefined);
    const entry = this.#entries.get(from);
    if (!entry || this.#entries.has(to) || this.#opening.has(to)) return false;
    // 还没发出去的输出以旧键发出去，渲染进程还在旧键上订阅。
    entry.batcher.flush();
    this.#entries.delete(from);
    entry.key = to;
    this.#entries.set(to, entry);
    return true;
  }

  write(key: TerminalKey, data: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    try {
      entry.pty.write(data);
    } catch (error) {
      this.#deps.onError("terminal: write failed", error);
    }
  }

  resize(key: TerminalKey, cols: number, rows: number): void {
    const entry = this.#entries.get(key);
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
   * 结束终端（整棵进程树）；不发 terminalExit（调用方就是发起者，已经知道）。
   * 状态和监听同步摘掉；返回的 promise 在进程树被结束之后才 resolve：Windows 上进程占着目录，
   * 删 worktree 之前必须等它。
   */
  close(key: TerminalKey): Promise<void> {
    // 正在起：等它起好再结束，否则这个终端会成为没人管的孤儿。
    const pending = this.#opening.get(key);
    if (pending)
      return pending.then(
        () => this.close(key),
        () => undefined,
      );
    const entry = this.#entries.get(key);
    if (!entry) return Promise.resolve();
    this.#detach(entry);
    entry.batcher.discard();
    return this.#kill(entry);
  }

  /**
   * 整个"taskkill → 等退出事件"在 `withPtyLock` 里（node-pty 原生层没有锁，见 platform/pty-lock.ts）：
   * taskkill 一返回就 `pty.kill()` 会撞上退出线程的收尾；所以先等退出，`pty.kill()` 只留给没被结束的进程。
   */
  async #kill(entry: Entry): Promise<void> {
    await withPtyLock(async () => {
      let hasExited = false;
      const exited = Promise.withResolvers<void>();
      const subscription = entry.pty.onExit(() => {
        hasExited = true;
        exited.resolve();
      });
      // 先杀整棵树再关 pty：shell 先死的话子进程被重新挂靠，按父子关系就找不到它们了。
      try {
        await this.#deps.killTree(entry.pty.pid);
      } catch (error) {
        this.#deps.onError("terminal: killing the process tree failed", error);
      }
      // 非 Windows 的 killTree 什么也不做，不用等。
      if (process.platform === "win32" && !hasExited) {
        const timer = setTimeout(() => exited.resolve(), KILL_GRACE_MS);
        await exited.promise;
        clearTimeout(timer);
      }
      // 退出之后再 kill：原生层的句柄已经被退出线程清掉，这一下只是关 node-pty 这一侧的管道；没退出的（taskkill 没结束它）由它结束。
      try {
        entry.pty.kill();
      } catch (error) {
        // 树已经杀掉时 node-pty 可能报进程不存在。
        this.#deps.onError("terminal: kill failed", error);
      }
      subscription.dispose();
    });
    entry.releaseJob();
  }

  async closeAll(): Promise<void> {
    const keys = [...this.#entries.keys(), ...this.#opening.keys()];
    await Promise.all(keys.map((key) => this.close(key)));
  }

  #detach(entry: Entry): void {
    for (const subscription of entry.subscriptions) subscription.dispose();
    entry.subscriptions = [];
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
  }
}
