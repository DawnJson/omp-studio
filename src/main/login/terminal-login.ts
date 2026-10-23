// 应用内终端登录（docs/architecture/login.md "应用内登录"）：github-copilot、alibaba-*、perplexity、snowflake、lm-studio 这几个 provider
// 的登录要多步交互，rpc-ui 直接拒绝（"requires interactive prompts"），只有 TUI 里的 `/login <provider>` 能走完。
// 这里起一个临时的交互式 omp（TSP，和任务同一套握手、文档、关进程树），发 `/login <provider>`，把 omp 画出的登录窗经 TERMINAL_LOGIN_ID
// 这条 TSP 通道交给渲染进程，用户的点击、输入照常经 sendTspEvent / sendTspKeys 回来；登录结束（成功、失败、取消）就关掉进程。
// 凭据由 omp 自己写进它的 agent 目录（用户真实的那份，登录本来就是要写凭据），这里不碰。
// 不 import electron：运行环境（启动参数、外观、provider 列表、事件出口）由调用方注入，单元测试用假 omp。
import { TERMINAL_LOGIN_ID, type LoginOutcome, type TspBatch, type TspSnapshot } from "../../shared/ipc.ts";
import { createDocument, snapshotDocument, type TspDocument } from "../../shared/tsp/document.ts";
import { findMessageTarget } from "../../shared/tsp/gate.ts";
import { deriveLoginFlow } from "../../shared/tsp/login-flow.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import { log } from "../log/log.ts";
import type { OmpLaunch } from "../omp/omp-connection.ts";
import {
  buildTspEnv,
  TspExitedError,
  TspHandshakeError,
  TspSession,
  type TspSessionOptions,
} from "../tsp/tsp-session.ts";

/** 登录窗的列数：只决定 omp 排版时假定的宽度，对话框里的文字按 CSS 折行。 */
const LOGIN_COLS = 80;
/** omp 起来之后输入框多久还没就绪就放弃（正常几百毫秒；首次运行引导没关掉时它永远不会就绪）。 */
const COMPOSER_TIMEOUT_MS = 30_000;
/** 登录窗关了、却没看到成功 / 失败 / 取消的任何文字：等这么久再认定 omp 的文字变了（结果文字和关窗在同一帧，正常不需要等）。 */
const RESULT_GRACE_MS = 1_500;
/** 启动失败时带上的 omp 终端输出行数。 */
const TAIL_LINES = 4;

export const LOGIN_CANCELLED = "cancelled";

export interface TerminalLoginDeps {
  /** omp 登录 provider 的 id（`get_login_providers`）：只有这里面的 id 才会起进程，渲染进程传来的 id 不可信。 */
  providerIds(): Promise<readonly string[]>;
  /** 临时 omp 的启动方式：可执行文件、参数、studio 自己的临时 cwd、环境（不改 PI_CODING_AGENT_DIR）。 */
  launch(): Promise<OmpLaunch>;
  appVersion: string;
  appearance(): { dark: boolean; reduceMotion: boolean };
  /** TSP 批次的出口（经 IPC 推给渲染进程）。 */
  onBatch(batch: TspBatch): void;
  /** 测试替身（假 pty、假 taskkill、跳过 Job Object、缩短握手超时）。 */
  session?: Partial<Pick<TspSessionOptions, "spawn" | "killTree" | "assignJob" | "helloTimeoutMs">>;
  composerTimeoutMs?: number;
  resultGraceMs?: number;
}

/** 一次登录：从起进程到出结果、进程关掉。 */
class LoginRun {
  readonly #deps: TerminalLoginDeps;
  readonly #providerId: string;
  readonly #outcome = Promise.withResolvers<LoginOutcome>();
  readonly #onEnded: (lastSeq: number) => void;
  readonly #seqBase: number;
  session: TspSession | null = null;
  #sent = false;
  #sawOverlay = false;
  #finishing = false;
  #done: Promise<void> | null = null;
  /** 进程的启动（成功得到会话，失败是 null）：结束时要等它落定，才知道有没有进程要关。 */
  #starting: Promise<TspSession | null> = Promise.resolve(null);
  #composerTimer: NodeJS.Timeout | undefined;
  #graceTimer: NodeJS.Timeout | undefined;

  constructor(deps: TerminalLoginDeps, providerId: string, seqBase: number, onEnded: (lastSeq: number) => void) {
    this.#deps = deps;
    this.#providerId = providerId;
    this.#seqBase = seqBase;
    this.#onEnded = onEnded;
  }

  get finished(): boolean {
    return this.#finishing;
  }

  /** 起进程、发 `/login`，等到结果（此时进程已经关了）。 */
  async run(): Promise<LoginOutcome> {
    const starting = this.#spawn();
    this.#starting = starting.catch(() => null);
    try {
      const session = await starting;
      if (this.#finishing) return this.#outcome.promise;
      this.#composerTimer = setTimeout(
        () =>
          void this.#finish({
            ok: false,
            message: "omp's input box did not become ready in time to start the sign-in",
          }),
        this.#deps.composerTimeoutMs ?? COMPOSER_TIMEOUT_MS,
      );
      await session.ready;
      this.#observe(session.document);
    } catch (error) {
      await this.#finish({ ok: false, message: describeStartError(error) });
    }
    return this.#outcome.promise;
  }

  async #spawn(): Promise<TspSession> {
    const launch = await this.#deps.launch();
    if (this.#finishing) throw new Error(LOGIN_CANCELLED);
    const session = await TspSession.start({
      launch: { ...launch, env: buildTspEnv(launch.env, this.#deps.appVersion) },
      cols: LOGIN_COLS,
      appVersion: this.#deps.appVersion,
      appearance: this.#deps.appearance(),
      ...this.#deps.session,
      onBatch: (batch) => {
        if (!this.#finishing) {
          this.#deps.onBatch({
            taskId: TERMINAL_LOGIN_ID,
            firstSeq: this.#seqBase + batch.firstSeq,
            messages: batch.messages,
          });
        }
      },
      onChange: (document) => this.#observe(document),
      onExit: (exit) => {
        if (this.#finishing) return;
        const tail = exit.textTail.trim().split(/\r?\n/).slice(-TAIL_LINES).join("\n");
        void this.#finish({
          ok: false,
          message: tail === "" ? `omp exited (${exit.exitCode ?? exit.signal ?? "unknown status"})` : tail,
        });
      },
    });
    this.session = session;
    return session;
  }

  /** 结束这次登录（用户取消、被新的登录顶替、退出应用）；返回时进程已经关了。 */
  end(outcome: LoginOutcome): Promise<void> {
    return this.#finish(outcome);
  }

  #observe(document: TspDocument): void {
    const session = this.session;
    if (!session || this.#finishing) return;
    if (!this.#sent) {
      const target = findMessageTarget(document);
      if (target.kind !== "ready") return;
      this.#sent = true;
      clearTimeout(this.#composerTimer);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: `/login ${this.#providerId}` });
      return;
    }
    const flow = deriveLoginFlow(document);
    switch (flow.kind) {
      case "running":
        this.#sawOverlay = true;
        clearTimeout(this.#graceTimer);
        this.#graceTimer = undefined;
        return;
      case "success":
        void this.#finish({ ok: true, providerId: this.#providerId });
        return;
      case "cancelled":
        void this.#finish({ ok: false, message: LOGIN_CANCELLED });
        return;
      case "failed":
        void this.#finish({ ok: false, message: flow.message });
        return;
      case "idle":
        // 登录窗开过、现在没了、也没有任何结果文字：omp 的措辞变了。等一小会儿（结果文字和关窗同帧，来了就是上面几种）再放弃。
        if (this.#sawOverlay && this.#graceTimer === undefined) {
          this.#graceTimer = setTimeout(
            () => void this.#finish({ ok: false, message: "omp closed the sign-in window without reporting a result" }),
            this.#deps.resultGraceMs ?? RESULT_GRACE_MS,
          );
        }
        return;
    }
  }

  #finish(outcome: LoginOutcome): Promise<void> {
    if (this.#done) return this.#done;
    this.#finishing = true;
    clearTimeout(this.#composerTimer);
    clearTimeout(this.#graceTimer);
    this.#done = this.#shutdown(outcome);
    return this.#done;
  }

  async #shutdown(outcome: LoginOutcome): Promise<void> {
    // 进程还在启动时被结束（取消、被顶替）：等它落定，起来了就关。进程关掉之后才报告结果，调用方据此知道没有残留的 omp。
    const session = this.session ?? (await this.#starting);
    let lastSeq = 0;
    if (session) {
      lastSeq = session.snapshot().seq;
      await session.close();
    }
    log.info("terminal login finished", {
      providerId: this.#providerId,
      ok: outcome.ok,
      ...(!outcome.ok && { reason: outcome.message === LOGIN_CANCELLED ? LOGIN_CANCELLED : "failed" }),
    });
    this.#onEnded(lastSeq);
    this.#outcome.resolve(outcome);
  }
}

function describeStartError(error: unknown): string {
  if (error instanceof TspHandshakeError || error instanceof TspExitedError) {
    const tail = error instanceof TspHandshakeError ? error.textTail : error.exit.textTail;
    const lines = tail.trim().split(/\r?\n/).slice(-TAIL_LINES).join("\n");
    return lines === "" ? error.message : `${error.message}\n${lines}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 单例用的服务：同一时间最多一个登录；渲染进程只知道 TERMINAL_LOGIN_ID。 */
export class TerminalLogin {
  readonly #deps: TerminalLoginDeps;
  #active: LoginRun | null = null;
  /** 之前那些进程占用的序号：新进程的批次从这之后编号，渲染进程手里的旧镜像会因此发现丢了帧、重新拉快照。 */
  #seqBase = 0;

  constructor(deps: TerminalLoginDeps) {
    this.#deps = deps;
  }

  /**
   * 跑一次登录，结果出来、临时 omp 关掉后 resolve。`providerId` 不在 omp 的登录 provider 里就 reject（不起进程）；
   * 已经有一个在进行时先结束它（渲染进程重载后旧对话框没了，不能让新的登录被挡住）。
   */
  async start(providerId: string): Promise<LoginOutcome> {
    const known = await this.#deps.providerIds();
    if (!known.includes(providerId)) throw new Error("unknown login provider");
    // 旧的结束（进程关掉、序号记账）之后才建新的；两次 start 交错时后到的会顶掉先到的，循环保证登记新 run 时没有旧的。
    while (this.#active) await this.#active.end({ ok: false, message: LOGIN_CANCELLED });
    const run = new LoginRun(this.#deps, providerId, this.#seqBase, (lastSeq) => {
      // 进程关掉了：序号往后让一格，下一个进程的批次必然比任何旧镜像新。
      if (this.#active === run) this.#active = null;
      this.#seqBase += lastSeq + 1;
    });
    this.#active = run;
    return run.run();
  }

  /** 结束正在进行的登录（关临时 omp，`start` 以"cancelled"结束）；没有时什么都不做。 */
  async cancel(): Promise<void> {
    await this.#active?.end({ ok: false, message: LOGIN_CANCELLED });
  }

  /** 应用退出：和 cancel 一样关进程。 */
  shutdown(): Promise<void> {
    return this.cancel();
  }

  /** 登录窗的节点树；没有进程时是空文档（序号接在上一个进程之后）。 */
  snapshot(): TspSnapshot {
    const session = this.#active?.session;
    if (session && !this.#active?.finished) {
      const current = session.snapshot();
      return { taskId: TERMINAL_LOGIN_ID, seq: this.#seqBase + current.seq, document: current.document };
    }
    return { taskId: TERMINAL_LOGIN_ID, seq: this.#seqBase, document: snapshotDocument(createDocument()) };
  }

  /**
   * 用户在登录窗里的操作（点按钮、输入）。`send` 不收：登录窗不需要它，放行就等于让渲染进程把临时 omp 当成可以提问的会话。
   */
  sendEvent(event: TspEvent): void {
    if (event.ev === "send") throw new Error("a terminal login only accepts clicks and input");
    this.#liveSession().sendEvent(event);
  }

  sendKeys(data: string): void {
    this.#liveSession().sendKeys(data);
  }

  #liveSession(): TspSession {
    const run = this.#active;
    if (!run?.session || run.finished) throw new Error("no terminal login is in progress");
    return run.session;
  }
}
