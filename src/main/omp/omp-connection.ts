// 一个 `omp --mode rpc-ui` 子进程的连接：启动、握手（协商协议 v2）、按 id 对应命令应答、转发其余帧、关闭。
// 协议见 omp 文档 rpc.md；实测行为见 docs/architecture/omp-rpc.md。
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { FrameDecoder, type RawFrame } from "./frame-decoder.ts";
import type {
  PromptParams,
  PromptResultEvent,
  ReadyEvent,
  RpcInbound,
  RpcResponse,
  RpcServerFrame,
  RpcWireCommands,
} from "../../shared/omp-wire/rpc-wire.generated.ts";

export type CommandType = keyof RpcWireCommands;
type CommandParams<K extends CommandType> = RpcWireCommands[K]["params"];
type CommandResult<K extends CommandType> = RpcWireCommands[K]["result"];
/** 无参数的命令不需要第二个实参。 */
type ParamsArg<K extends CommandType> = CommandParams<K> extends undefined ? [] : [params: CommandParams<K>];

export interface OmpLaunch {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface OmpConnectionOptions {
  /** 等 `ready` 帧的上限。 */
  readyTimeoutMs?: number;
}

export interface OmpExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 由 omp-studio 按进程树强制结束的。 */
  killed: boolean;
  /** 导致连接中断的错误：协议错误或启动失败。正常退出时为 null。 */
  error: Error | null;
  /** stderr 的最后一部分，用于诊断。 */
  stderrTail: string;
}

/**
 * 一条 prompt 的结局。rpc.md：被接受的 prompt 恰好完成一次——应答里 `agentInvoked: false`（本地就完成了，
 * 不会再有 `prompt_result`），或者之后一个同 id 的 `prompt_result`。
 */
export type PromptOutcome = { agentInvoked: false } | PromptResultEvent;

/** 命令的应答 `success: false`。 */
export class RpcCommandError extends Error {
  override name = "RpcCommandError";
  readonly command: string;
  readonly code: string | undefined;

  constructor(response: RpcResponse) {
    super(response.error ?? `${response.command} failed`);
    this.command = response.command;
    this.code = response.code;
  }
}

/** 出站帧超过 `ready` 声明的 maxFrameBytes：omp 会丢弃它，调用方却在等应答，所以在本地拒绝。 */
class FrameTooLargeError extends Error {
  override name = "FrameTooLargeError";
  readonly limit: number;

  constructor(bytes: number, limit: number) {
    super(`frame is ${bytes} bytes, larger than the ${limit}-byte frame limit`);
    this.limit = limit;
  }
}

/** omp 在命令得到应答之前退出了。 */
export class OmpExitedError extends Error {
  override name = "OmpExitedError";
  readonly exit: OmpExit;

  constructor(exit: OmpExit) {
    super(exit.error ? `omp exited: ${exit.error.message}` : `omp exited with code ${exit.code ?? exit.signal}`);
    this.exit = exit;
  }
}

const DEFAULT_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const STDERR_TAIL_CHARS = 16 * 1024;
/** 强制结束后等 `close` 事件的上限，超过就销毁管道。 */
const KILL_GRACE_MS = 2_000;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

export class OmpConnection {
  /** 握手完成（收到 `ready`，并在支持时协商好 v2）后 resolve。失败时 omp 已被结束。 */
  readonly ready: Promise<void>;
  /** omp 进程退出后 resolve，不会 reject。 */
  readonly exited: Promise<OmpExit>;

  #child: ChildProcessWithoutNullStreams;
  #decoder = new FrameDecoder(DEFAULT_MAX_REASSEMBLED_BYTES);
  #pending = new Map<string, PendingRequest>();
  #promptWaiters = new Map<string, PromiseWithResolvers<PromptResultEvent>>();
  #frameListeners = new Set<(frame: RpcServerFrame) => void>();
  #nextId = 1;
  #protocolVersion = 1;
  #exit: OmpExit | null = null;
  #fatal: Error | null = null;
  #killed = false;
  #stderrTail = "";
  #maxFrameBytes: number | null = null;
  #onReadyFrame: ((frame: ReadyEvent) => void) | null = null;
  /** omp 进程本身已退出（`exit` 事件）。`close` 事件要等 stdio 全部关闭，孙进程拿着管道时会晚到。 */
  #processExited = false;

  /**
   * 启动 omp。返回时进程已经在启动、帧还没开始读：调用方在同一个同步代码块里挂上 `onFrame`，
   * 就不会漏掉握手期间 omp 主动发出的帧（如 `available_commands_update`）。
   */
  static spawn(launch: OmpLaunch, options: OmpConnectionOptions = {}): OmpConnection {
    return new OmpConnection(launch, options);
  }

  private constructor(launch: OmpLaunch, options: OmpConnectionOptions) {
    this.#child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const exited = Promise.withResolvers<OmpExit>();
    this.exited = exited.promise;
    this.#child.on("error", (error) => this.#fail(error));
    this.#child.on("exit", () => {
      this.#processExited = true;
    });
    this.#child.on("close", (code, signal) => {
      if (!this.#fatal) {
        try {
          this.#decoder.end();
        } catch (error) {
          this.#fatal = error as Error;
        }
      }
      const exit: OmpExit = { code, signal, killed: this.#killed, error: this.#fatal, stderrTail: this.#stderrTail };
      this.#exit = exit;
      const exitError = new OmpExitedError(exit);
      for (const pending of this.#pending.values()) pending.reject(exitError);
      this.#pending.clear();
      for (const waiter of this.#promptWaiters.values()) waiter.reject(exitError);
      this.#promptWaiters.clear();
      exited.resolve(exit);
    });

    this.#child.stdout.on("data", (data: Buffer) => {
      if (this.#fatal) return;
      let frames: RawFrame[];
      try {
        frames = this.#decoder.push(data);
      } catch (error) {
        this.#fail(error as Error);
        return;
      }
      for (const frame of frames) {
        if (this.#fatal) return;
        this.#dispatch(frame);
      }
    });
    this.#child.stderr.on("data", (data: Buffer) => {
      this.#stderrTail = (this.#stderrTail + data.toString("utf8")).slice(-STDERR_TAIL_CHARS);
    });
    // omp 退出后再写 stdin 会报 EPIPE；退出原因由 `exited` 报告，这里不重复处理。
    this.#child.stdin.on("error", () => {});

    this.ready = this.#handshake(options.readyTimeoutMs ?? 30_000);
    // 握手失败由 `ready` 的调用方处理；这里只防止没人 await 时出现未处理的 rejection。
    this.ready.catch(() => {});
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** 协商后的协议版本：1 或 2。 */
  get protocolVersion(): number {
    return this.#protocolVersion;
  }

  /** `ready` 帧声明的入站帧大小上限（字节）；服务端没有声明时为 null。 */
  get maxFrameBytes(): number | null {
    return this.#maxFrameBytes;
  }

  /** 订阅除命令应答以外的所有帧（通知、会话事件、host 请求，以及对不上请求的应答）。返回取消订阅函数。 */
  onFrame(listener: (frame: RpcServerFrame) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /** 发送一条命令，等它的应答。`success: false` 时 reject `RpcCommandError`。 */
  request<K extends CommandType>(type: K, ...params: ParamsArg<K>): Promise<CommandResult<K>> {
    return this.#request(type, params[0]).response;
  }

  /**
   * 发送 `prompt`，等它完成：应答带 `agentInvoked: false` 时立即返回，否则等同 id 的 `prompt_result`。
   * 期间的会话事件照常从 `onFrame` 发出，`prompt_result` 也会。
   */
  async prompt(params: PromptParams): Promise<PromptOutcome> {
    const { id, response } = this.#request("prompt", params);
    const result = Promise.withResolvers<PromptResultEvent>();
    // 应答失败时没人等 result；omp 之后退出会 reject 它，这里避免成为未处理的 rejection。
    result.promise.catch(() => {});
    this.#promptWaiters.set(id, result);
    try {
      const ack = await response;
      if (ack?.agentInvoked === false) return { agentInvoked: false };
      return await result.promise;
    } finally {
      this.#promptWaiters.delete(id);
    }
  }

  #request<K extends CommandType>(
    type: K,
    params: CommandParams<K> | undefined,
  ): { id: string; response: Promise<CommandResult<K>> } {
    const id = `req-${this.#nextId++}`;
    if (this.#exit) return { id, response: Promise.reject(new OmpExitedError(this.#exit)) };
    this.#assertFits({ ...params, id, type });
    const { promise, resolve, reject } = Promise.withResolvers<CommandResult<K>>();
    // 应答的 `data` 按命令类型由 wire schema 约定；这里不做运行时校验。
    this.#pending.set(id, { resolve: (data) => resolve(data as CommandResult<K>), reject });
    this.#write({ ...params, id, type });
    return { id, response: promise };
  }

  /** 发送不需要应答的帧：extension UI 应答、host tool / URI 结果。 */
  send(frame: RpcInbound): void {
    if (this.#exit) throw new OmpExitedError(this.#exit);
    this.#assertFits(frame);
    this.#write(frame);
  }

  /**
   * 正常关闭：关闭 stdin（omp 会结束正在跑的工具、释放会话后退出），期间继续读 stdout。
   * 超过 `timeoutMs` 还没退出就按进程树强制结束。
   */
  async close(timeoutMs = 5_000): Promise<OmpExit> {
    if (this.#exit) return this.#exit;
    this.#child.stdin.end();
    const timedOut = Promise.withResolvers<"timeout">();
    const timer = setTimeout(() => timedOut.resolve("timeout"), timeoutMs);
    const outcome = await Promise.race([this.exited, timedOut.promise]);
    clearTimeout(timer);
    if (outcome === "timeout") await this.#killTree();
    return this.exited;
  }

  #assertFits(frame: object): void {
    if (this.#maxFrameBytes === null) return;
    const bytes = Buffer.byteLength(JSON.stringify(frame)) + 1;
    if (bytes > this.#maxFrameBytes) throw new FrameTooLargeError(bytes, this.#maxFrameBytes);
  }

  #write(frame: object): void {
    this.#child.stdin.write(JSON.stringify(frame) + "\n");
  }

  #dispatch(frame: RawFrame): void {
    // 监听器是主进程自己的代码。它们抛错说明主进程状态已经不可信，按致命错误结束这个连接，
    // 错误放进 `exited.error`，而不是变成 uncaughtException 并丢掉同一批里后面的帧。
    try {
      this.#route(frame);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #route(frame: RawFrame): void {
    // 帧的结构由 omp 的 wire schema 约定，这里只按 `type` 分发，不做逐字段校验。
    // 不认识的 `type` 也原样交给监听器（rpc.md：未知帧当作未知通知），所以监听器要有默认分支。
    const serverFrame = frame as RpcServerFrame;
    if (serverFrame.type === "ready") {
      this.#onReadyFrame?.(serverFrame);
      return;
    }
    if (serverFrame.type === "response" && serverFrame.id !== undefined) {
      const pending = this.#pending.get(serverFrame.id);
      if (pending) {
        this.#pending.delete(serverFrame.id);
        if (serverFrame.success) pending.resolve(serverFrame.data);
        else pending.reject(new RpcCommandError(serverFrame));
        return;
      }
    }
    if (serverFrame.type === "prompt_result" && serverFrame.id !== undefined)
      this.#promptWaiters.get(serverFrame.id)?.resolve(serverFrame);
    for (const listener of this.#frameListeners) listener(serverFrame);
  }

  /** 整个握手（等 `ready`、协商 v2）共用一个截止时间。 */
  async #handshake(timeoutMs: number): Promise<void> {
    const readyFrame = Promise.withResolvers<ReadyEvent>();
    this.#onReadyFrame = readyFrame.resolve;
    const deadline = Promise.withResolvers<never>();
    // 握手结束后 omp 退出时 deadline 还会 reject，没人等它，避免成为未处理的 rejection。
    deadline.promise.catch(() => {});
    const timer = setTimeout(
      () => deadline.reject(new Error(`omp did not finish the handshake within ${timeoutMs} ms`)),
      timeoutMs,
    );
    void this.exited.then((exit) => deadline.reject(new OmpExitedError(exit)));
    const withinDeadline = <T>(step: Promise<T>) => Promise.race([step, deadline.promise]);
    try {
      const ready = await withinDeadline(readyFrame.promise);
      this.#maxFrameBytes = ready.maxFrameBytes ?? null;
      if (!ready.supportedProtocolVersions?.includes(2)) return;
      await withinDeadline(this.request("negotiate_protocol", { protocolVersion: 2 }));
      this.#protocolVersion = 2;
      this.#decoder.setMaxReassembledBytes(ready.maxReassembledFrameBytes ?? DEFAULT_MAX_REASSEMBLED_BYTES);
    } catch (error) {
      await this.#killTree();
      throw error;
    } finally {
      clearTimeout(timer);
      this.#onReadyFrame = null;
    }
  }

  #fail(error: Error): void {
    if (this.#fatal) return;
    this.#fatal = error;
    void this.#killTree();
  }

  /**
   * 按进程树强制结束 omp，返回时 `exited` 已经 resolve。
   * omp 已经退出、但孙进程还拿着它的 stdout 时，`close` 事件不会来，这时不再 taskkill（pid 可能已被复用），
   * 直接销毁管道，让 `close` 发出。
   */
  async #killTree(): Promise<void> {
    const pid = this.#child.pid;
    if (this.#exit) return;
    this.#killed = true;
    if (pid !== undefined && !this.#processExited) {
      if (process.platform === "win32") {
        // 用绝对路径：不带路径时 Windows 会先在当前目录里找 taskkill。进程刚好自己退出时 taskkill 会失败，忽略即可。
        const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
        const done = Promise.withResolvers<void>();
        execFile(taskkill, ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => done.resolve());
        await done.promise;
      } else {
        this.#child.kill("SIGKILL");
      }
    }
    const timedOut = Promise.withResolvers<"timeout">();
    const timer = setTimeout(() => timedOut.resolve("timeout"), KILL_GRACE_MS);
    const outcome = await Promise.race([this.exited, timedOut.promise]);
    clearTimeout(timer);
    if (outcome === "timeout") {
      this.#child.stdin.destroy();
      this.#child.stdout.destroy();
      this.#child.stderr.destroy();
      await this.exited;
    }
  }
}
