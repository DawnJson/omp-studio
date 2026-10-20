// TSP 会话：伪终端里的一个交互式 omp，我们扮演 Tern 终端（docs/architecture/tsp-migration.md）。
// 职责：起 pty、回 hello 和 DA1、把 o/f/t/x/b 应用到自己的文档（权威副本）、按规范回 ack 和 error 事件、
// 把应用过的消息按 16ms 合批推给渲染进程、解析 OSC（会话文件、标题、通知），以及关进程树。
// node-pty、Job Object、taskkill 都从 options 注入（默认是真实实现），单元测试可以换成假的。
// 协议细节见 E:/tern-probe/spec/protocol-*.md（Tern SDK 文档 protocol/*）。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import {
  applyMessage,
  createDocument,
  snapshotDocument,
  type DocumentSnapshot,
  type TspDocMessage,
  type TspDocument,
} from "../../shared/tsp/document.ts";
import {
  TSP_DEFAULT_APC_LIMIT,
  TSP_DEFAULT_CREDITS,
  TSP_KINDS,
  TSP_VERSION,
  type TspClose,
  type TspEvent,
  type TspFrame,
  type TspOpen,
  type TspPalette,
} from "../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { log } from "../log/log.ts";
import { assignToOwnJob } from "../platform/win32/job-object.ts";
import { TspStreamParser, type TspStreamEvent } from "./stream.ts";

/** 回 hello 和 error 事件的终端名。 */
const TERM_NAME = "omp-studio";
/** 回给 omp 的 DA1 应答（VT220 级，带 ANSI 颜色）：和 Tern 一样只作为 hello 之后的哨兵。 */
const DA1_REPLY = "\x1b[?62;22c";
/** pty 的行数：inline surface 不用它，只有 omp 回退到 ANSI 渲染时才有意义。 */
const DEFAULT_ROWS = 40;
const BATCH_INTERVAL_MS = 16;
const HELLO_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
/** 报错时带上的 omp 原始文字（启动失败时它直接打在终端上）。 */
const TEXT_TAIL_CHARS = 4_000;
/** 规范：一个 blob 解码后最大 16 MiB。 */
const MAX_BLOB_BYTES = 16 * 1024 * 1024;

/**
 * 我们实际处理得了的终端特性（hello 回复的 `features`，注意和 omp 在 hello 查询里声明的程序特性 edit/undo/send 不是一回事）：
 * - `blobs`：`b` 消息和 `blobs` 查询（文档里存 base64，下面回 have）。
 * - `settle`：只是性能提示，文档不变。
 * - `adopt`：`o` 带 `adopt:true` 时接管已有 surface（document.ts 已实现）。
 * - `dock`：`dock` 区域贴着面板底部（渲染进程布局）。
 * - `program-palette`：`t` 消息（文档里存调色板，渲染进程着色）。
 * - `scroll`：`scroll` 操作（文档里是空操作，滚动由渲染进程按焦点处理）。
 * - `reduce-motion`：hello 的 `reduceMotion` 和 `motion` 事件。
 * 不声明：`aside`（prefs 贴在面板旁边）、`styles`（`s` 消息：程序自带 CSS 不支持）、`flow`（flow surface）。
 */
export const TSP_TERMINAL_FEATURES = [
  "blobs",
  "settle",
  "adopt",
  "dock",
  "program-palette",
  "scroll",
  "reduce-motion",
] as const;

/** 一个伪终端。和 node-pty 的 IPty 结构兼容（onData 在 `encoding: null` 时给 Buffer）。 */
export interface TspPty {
  readonly pid: number;
  onData(listener: (data: Uint8Array | string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TspPtyLaunch {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}

/** 真实的 node-pty。Windows 必须用 node-pty 自带的 ConPTY（`useConptyDll`）：系统自带的会吞掉 APC，一帧都收不到。 */
export async function spawnNodePty(launch: TspPtyLaunch, size: { cols: number; rows: number }): Promise<TspPty> {
  // 原生模块按需加载（同 terminal/runtime.ts）：加载失败只影响 TSP 任务，不影响应用启动。
  const nodePty = await import("node-pty");
  return nodePty.spawn(launch.command, [...launch.args], {
    name: "xterm-256color",
    cols: size.cols,
    rows: size.rows,
    cwd: launch.cwd,
    env: launch.env,
    useConptyDll: true,
    // 字节流：TSP 分块可能切在 UTF-8 字符中间，要在解析器里按字节拼接后再解码。
    encoding: null,
  });
}

/** Windows：结束进程和它的所有后代（node-pty 的 kill 只关 omp 本身）。用绝对路径：不带路径时 Windows 会先在当前目录里找。 */
export function killProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  const killer = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
  const done = Promise.withResolvers<void>();
  // 进程已经自己退出时命令会失败，忽略即可。
  execFile(killer, ["/T", "/F", "/PID", String(pid)], { windowsHide: true, timeout: 5000 }, () => done.resolve());
  return done.promise;
}

/** TSP 任务进程的环境：扮演 Tern（omp 看 `TERM_PROGRAM=tern` 才发 hello）。 */
export function buildTspEnv(base: NodeJS.ProcessEnv, appVersion: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value;
  env["TERM_PROGRAM"] = "tern";
  env["TERM_PROGRAM_VERSION"] = appVersion;
  env["TERM"] = "xterm-256color";
  env["COLORTERM"] = "truecolor";
  return env;
}

/** 把 TSP 消息写给 omp：`ESC _ tsp;e;<json> ESC \`。U+0080–U+009F 在 JSON 里转义：它们是 C1 控制字符，会被终端层当成序列终止符。 */
export function encodeTspEvent(event: TspEvent): string {
  const json = JSON.stringify(event).replace(
    /[\u0080-\u009f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `\x1b_tsp;e;${json}\x1b\\`;
}

export interface TspSessionBatch {
  /** 第一条消息的序号；第 i 条是 firstSeq + i。 */
  firstSeq: number;
  messages: TspDocMessage[];
}

export interface TspSessionExit {
  exitCode: number | null;
  signal: number | null;
  /** 是我们自己关的（close()）。 */
  closing: boolean;
  /** omp 打在终端上的最后一段文字（启动失败时的错误信息）。 */
  textTail: string;
}

/** 等了 HELLO_TIMEOUT_MS 也没收到 hello 查询：omp 没有进入 TSP 模式。 */
export class TspHandshakeError extends Error {
  override name = "TspHandshakeError";
  readonly textTail: string;
  constructor(message: string, textTail: string) {
    super(message);
    this.textTail = textTail;
  }
}

/** 进程在握手完成前退出。 */
export class TspExitedError extends Error {
  override name = "TspExitedError";
  readonly exit: TspSessionExit;
  constructor(exit: TspSessionExit) {
    super(`omp exited with ${exit.exitCode ?? exit.signal ?? "unknown status"} before the TSP handshake`);
    this.exit = exit;
  }
}

export interface TspSessionOptions {
  launch: TspPtyLaunch;
  /** pty 的列数，同时是 hello 的 `cols`。 */
  cols: number;
  rows?: number;
  /** `TERM_PROGRAM_VERSION` 和 hello 的 `ver`：应用版本。 */
  appVersion: string;
  /** hello 回复里的外观；之后的变化由渲染进程发 `theme` / `motion` 事件。 */
  appearance: { dark: boolean; reduceMotion: boolean };
  /** 一批文档消息（16ms 合批）。 */
  onBatch(batch: TspSessionBatch): void;
  onExit(exit: TspSessionExit): void;
  /** 文档每次因 o/f/t/x/b 改变之后同步调用；任务状态据此推导。 */
  onChange?(document: TspDocument): void;
  /** `OSC 1337 SetUserVar=omp_session_file=<base64>`：当前会话文件（此时文件可能还没落盘）。 */
  onSessionFile?(file: string): void;
  /** OSC 0 / 2。 */
  onTitle?(title: string): void;
  /** OSC 9 / 99。 */
  onNotify?(notification: { title: string; body: string }): void;
  spawn?: (launch: TspPtyLaunch, size: { cols: number; rows: number }) => Promise<TspPty>;
  killTree?: (pid: number) => Promise<void>;
  /** 把进程放进它自己的 KILL_ON_JOB_CLOSE Job（主进程被强杀时由系统回收），返回释放函数。 */
  assignJob?: (pid: number | undefined) => () => void;
  helloTimeoutMs?: number;
}

export class TspSession {
  readonly #options: TspSessionOptions;
  readonly #pty: TspPty;
  readonly #doc: TspDocument = createDocument();
  readonly #parser: TspStreamParser;
  readonly #subscriptions: { dispose(): void }[] = [];
  readonly #killTree: (pid: number) => Promise<void>;
  readonly #releaseJob: () => void;
  readonly #exited = Promise.withResolvers<TspSessionExit>();
  readonly #ready = Promise.withResolvers<void>();
  /** 每条进文档的消息加一；批次和快照用它对齐。 */
  #seq = 0;
  #pending: TspDocMessage[] = [];
  #flushTimer: NodeJS.Timeout | undefined;
  #helloTimer: NodeJS.Timeout | undefined;
  #helloSeen = false;
  #closing = false;
  #hasExited = false;
  #cols: number;
  #textTail = "";
  /** 本块数据里每个 surface 最高的帧号：块处理完回一次 ack（规范：ack 覆盖此前所有帧）。 */
  readonly #acks = new Map<string, number>();

  private constructor(options: TspSessionOptions, pty: TspPty) {
    this.#options = options;
    this.#pty = pty;
    this.#cols = options.cols;
    this.#killTree = options.killTree ?? killProcessTree;
    this.#parser = new TspStreamParser((event) => this.#onStream(event));
    // 没人等 ready 时（进程在握手前就死了又不是 start() 的调用者在等）也不能变成未处理的拒绝。
    this.#ready.promise.catch(() => {});
    let release: () => void = () => undefined;
    try {
      release = (options.assignJob ?? assignToOwnJob)(pty.pid);
    } catch (error) {
      // 放不进 Job 不影响使用（正常退出仍由 close() 结束），只是主进程被强杀时少一层兜底。
      log.warn("tsp session: assigning the omp process to a job object failed", { message: String(error) });
    }
    this.#releaseJob = release;
    this.#subscriptions.push(pty.onData((data) => this.#onData(data)));
    this.#subscriptions.push(pty.onExit((event) => this.#onExit(event)));
    this.#helloTimer = setTimeout(() => {
      if (this.#helloSeen || this.#hasExited) return;
      this.#ready.reject(
        new TspHandshakeError("omp did not start the TSP handshake (no hello query was received)", this.#textTail),
      );
    }, options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
  }

  static async start(options: TspSessionOptions): Promise<TspSession> {
    const rows = options.rows ?? DEFAULT_ROWS;
    const pty = await (options.spawn ?? spawnNodePty)(options.launch, { cols: options.cols, rows });
    log.info("tsp session started", { pid: pty.pid });
    return new TspSession(options, pty);
  }

  // ───── 对外 ─────

  get pid(): number {
    return this.#pty.pid;
  }

  /** 权威文档（只读用；状态推导）。 */
  get document(): TspDocument {
    return this.#doc;
  }

  /** hello 已回复。进程在此之前退出或握手超时时 reject。 */
  get ready(): Promise<void> {
    return this.#ready.promise;
  }

  /** 进程退出（不论是自己退出还是 close()）。 */
  get exited(): Promise<TspSessionExit> {
    return this.#exited.promise;
  }

  get hasExited(): boolean {
    return this.#hasExited;
  }

  /** 当前文档和它对应的序号。先把待发的批次推出去：渲染进程拿到快照时不会再收到序号早于它的批次。 */
  snapshot(): { seq: number; document: DocumentSnapshot } {
    this.#flush();
    return { seq: this.#seq, document: snapshotDocument(this.#doc) };
  }

  /** 用户操作 → TSP 事件（`send`、`action`、`activate`、`edit`、`resize`…）。 */
  sendEvent(event: TspEvent): void {
    this.#write(encodeTspEvent(event));
  }

  /** 按键字节（Esc = `\x1b`，Enter = `\r`，Alt+P = `\x1bp`）。 */
  sendKeys(data: string): void {
    this.#write(data);
  }

  /** 面板宽度变了：改 pty 大小（omp 回退 ANSI 时用）并发 `resize` 事件（规范：Tern 用它更新 hello 里的 cols）。 */
  resize(cols: number): void {
    if (this.#hasExited || cols === this.#cols) return;
    this.#cols = cols;
    this.#pty.resize(cols, this.#options.rows ?? DEFAULT_ROWS);
    this.sendEvent({ ev: "resize", cols });
  }

  /** 结束进程树并等它退出。可重复调用；超时后不再等（进程树已被 taskkill）。 */
  async close(timeoutMs = CLOSE_TIMEOUT_MS): Promise<void> {
    if (this.#hasExited) return;
    this.#closing = true;
    const pid = this.#pty.pid;
    await this.#killTree(pid);
    try {
      this.#pty.kill();
    } catch (error) {
      // 进程刚好自己退出了。
      log.info("tsp session: kill after exit", { message: String(error) });
    }
    const timedOut = Symbol("timeout");
    const timeout = Promise.withResolvers<typeof timedOut>();
    const timer = setTimeout(() => timeout.resolve(timedOut), timeoutMs);
    const outcome = await Promise.race([this.#exited.promise, timeout.promise]);
    clearTimeout(timer);
    if (outcome === timedOut) {
      log.warn("tsp session: omp did not report exit after being killed", { pid });
      // 退出事件不会来了：按已退出处理，释放资源。
      this.#onExit({ exitCode: -1 });
    }
  }

  // ───── pty 数据 ─────

  #write(data: string): void {
    if (this.#hasExited) throw new Error("the omp process has exited");
    this.#pty.write(data);
  }

  #onData(data: Uint8Array | string): void {
    try {
      this.#parser.write(data);
    } catch (error) {
      // 回调（文档应用、任务状态、IPC）抛错不能冒到 node-pty 的数据事件里：那是主进程的未处理异常。
      log.error("tsp session: handling pty data failed", {
        message: error instanceof Error ? error.stack : String(error),
      });
    }
    if (this.#acks.size === 0) return;
    for (const [sf, s] of this.#acks) this.#safeEvent({ ev: "ack", sf, s });
    this.#acks.clear();
  }

  /** 内部回写（ack、error、hello 回复）：进程已经没了就算了，不是调用方的错。 */
  #safeSend(data: string): void {
    if (this.#hasExited) return;
    try {
      this.#pty.write(data);
    } catch (error) {
      log.warn("tsp session: write to pty failed", { message: String(error) });
    }
  }

  #safeEvent(event: TspEvent): void {
    this.#safeSend(encodeTspEvent(event));
  }

  #sendReply(reply: object): void {
    const json = JSON.stringify(reply).replace(
      /[\u0080-\u009f]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    this.#safeSend(`\x1b_tsp;r;${json}\x1b\\`);
  }

  #onStream(event: TspStreamEvent): void {
    switch (event.type) {
      case "tsp":
        this.#onTsp(event.verb, event.params, event.body);
        return;
      case "chunk-dropped":
        this.#safeEvent({
          ev: "error",
          msg: `chunked ${event.verb} message c=${event.chunk} dropped: ${event.reason === "over-limit" ? "over 25165824 bytes" : "interrupted"}`,
        });
        return;
      case "da1":
        this.#safeSend(DA1_REPLY);
        return;
      case "user-var":
        if (event.name === "omp_session_file" && event.value !== "") this.#options.onSessionFile?.(event.value);
        return;
      case "title":
        this.#options.onTitle?.(event.title);
        return;
      case "notify":
        this.#options.onNotify?.({ title: event.title, body: event.body });
        return;
      case "text":
        this.#textTail = (this.#textTail + event.text).slice(-TEXT_TAIL_CHARS);
        return;
    }
  }

  #onTsp(verb: string, params: Readonly<Record<string, string>>, body: string): void {
    if (verb === "b") {
      this.#blob(params, body);
      return;
    }
    if (verb !== "q" && verb !== "o" && verb !== "f" && verb !== "t" && verb !== "x") return; // 未知动词按规范忽略（`s` 样式表我们不声明支持）
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      this.#safeEvent({
        ev: "error",
        msg: `malformed ${verb} body: ${error instanceof Error ? error.message : String(error)}`,
      });
      log.warn("tsp session: malformed message body", { verb });
      return;
    }
    if (!isRecord(json)) {
      this.#safeEvent({ ev: "error", msg: `malformed ${verb} body: not an object` });
      return;
    }
    if (verb === "q") this.#query(json);
    else this.#documentMessage(verb, json);
  }

  // ───── 握手 ─────

  #query(query: Record<string, unknown>): void {
    if (query["q"] === "hello") {
      const versions = query["v"];
      // 规范：版本列表里没有 1 的查询得不到回复（omp 把它当成没有 TSP）。
      if (!Array.isArray(versions) || !versions.includes(TSP_VERSION)) {
        log.warn("tsp session: hello does not list protocol version 1", { versions });
        return;
      }
      this.#sendReply({
        r: "hello",
        v: TSP_VERSION,
        term: TERM_NAME,
        ver: this.#options.appVersion,
        kinds: TSP_KINDS,
        features: TSP_TERMINAL_FEATURES,
        apc: TSP_DEFAULT_APC_LIMIT,
        credits: TSP_DEFAULT_CREDITS,
        cols: this.#cols,
        dark: this.#options.appearance.dark,
        reduceMotion: this.#options.appearance.reduceMotion,
        hour12: new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 === true,
      });
      log.info("tsp session: hello", { app: query["app"], ver: query["ver"], features: query["features"] });
      if (!this.#helloSeen) {
        this.#helloSeen = true;
        clearTimeout(this.#helloTimer);
        this.#ready.resolve();
      }
      return;
    }
    if (query["q"] === "blobs") {
      const ids = Array.isArray(query["ids"]) ? query["ids"] : [];
      const have = ids.filter((id): id is string => typeof id === "string" && this.#doc.blobs.has(id.toLowerCase()));
      this.#sendReply({ r: "blobs", have });
    }
    // 其他查询：规范说不回复。
  }

  // ───── 文档 ─────

  #documentMessage(verb: "o" | "f" | "t" | "x", body: Record<string, unknown>): void {
    let message: TspDocMessage;
    switch (verb) {
      case "o":
        if (typeof body["id"] !== "string" || body["id"] === "") return this.#reject("o", "an o message needs an id");
        // flow surface 要 `flow` 特性，我们没声明；未知的 mode 同样是错误。
        if (body["mode"] !== "inline" && body["mode"] !== "screen")
          return this.#reject("o", `unknown mode ${String(body["mode"])}`);
        message = { verb, body: body as unknown as TspOpen };
        break;
      case "f":
        message = { verb, body: body as unknown as TspFrame };
        break;
      case "t":
        if (typeof body["sf"] !== "string") return this.#reject("t", "a t message needs sf");
        message = { verb, body: body as unknown as TspPalette };
        break;
      case "x":
        if (typeof body["id"] !== "string") return this.#reject("x", "an x message needs an id");
        message = { verb, body: body as unknown as TspClose };
        break;
    }
    this.#apply(message);
  }

  #blob(params: Readonly<Record<string, string>>, body: string): void {
    const id = params["id"] ?? "";
    if (!/^[0-9a-fA-F]{64}$/.test(id)) return this.#reject("b", "a blob needs a sha256 hex id");
    if (body.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body))
      return this.#reject("b", "blob is not valid base64");
    const bytes = Buffer.from(body, "base64");
    if (bytes.length > MAX_BLOB_BYTES) return this.#reject("b", "blob is larger than 16 MiB");
    if (createHash("sha256").update(bytes).digest("hex") !== id.toLowerCase())
      return this.#reject("b", "blob bytes do not match its id");
    this.#apply({ verb: "b", id: id.toLowerCase(), mime: params["mime"] ?? null, data: body });
  }

  #reject(verb: string, msg: string): void {
    log.warn("tsp session: message rejected", { verb, msg });
    this.#safeEvent({ ev: "error", msg });
  }

  #apply(message: TspDocMessage): void {
    const result = applyMessage(this.#doc, message);
    this.#seq += 1;
    this.#pending.push(message);
    this.#scheduleFlush();
    if (message.verb === "f") {
      const { sf, s } = message.body;
      if (typeof sf === "string" && typeof s === "number") this.#acks.set(sf, Math.max(this.#acks.get(sf) ?? 0, s));
      for (const error of result.errors) {
        log.warn("tsp session: op rejected", { sf, s, op: error.op, msg: error.msg });
        this.#safeEvent({
          ev: "error",
          ...(typeof sf === "string" && { sf }),
          ...(typeof s === "number" && { s }),
          ...(error.op >= 0 && { op: error.op }),
          msg: error.msg,
        });
      }
    } else if (result.errors.length > 0) {
      for (const error of result.errors) this.#safeEvent({ ev: "error", msg: error.msg });
    }
    this.#options.onChange?.(this.#doc);
  }

  // ───── 批次 ─────

  #scheduleFlush(): void {
    this.#flushTimer ??= setTimeout(() => this.#flush(), BATCH_INTERVAL_MS);
  }

  #flush(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    if (this.#pending.length === 0) return;
    const messages = this.#pending;
    this.#pending = [];
    this.#options.onBatch({ firstSeq: this.#seq - messages.length + 1, messages });
  }

  // ───── 退出 ─────

  #onExit(event: { exitCode: number; signal?: number }): void {
    if (this.#hasExited) return;
    this.#hasExited = true;
    clearTimeout(this.#helloTimer);
    for (const subscription of this.#subscriptions) subscription.dispose();
    try {
      // 进程已经没了：node-pty 的管道不会自己关，留着会一直占着句柄。
      this.#pty.kill();
    } catch {
      // 已经关过了。
    }
    this.#flush();
    this.#releaseJob();
    const exit: TspSessionExit = {
      exitCode: event.exitCode,
      signal: event.signal ?? null,
      closing: this.#closing,
      textTail: this.#textTail,
    };
    log.info("tsp session exited", { exitCode: exit.exitCode, signal: exit.signal, closing: exit.closing });
    if (!this.#helloSeen) this.#ready.reject(new TspExitedError(exit));
    this.#exited.resolve(exit);
    this.#options.onExit(exit);
  }
}
