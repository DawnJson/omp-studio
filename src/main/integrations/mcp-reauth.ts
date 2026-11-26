// MCP 服务器的 OAuth 登录（设置 → 扩展 → MCP 卡片的"登录"）：omp 19.2.1 起 rpc-ui 也认 `/mcp reauth <name>`，
// 命令在后台跑：应答先回来，omp 自己开浏览器、在 localhost 等回调，进度和结果陆续以 command_output 出来（classifyReauthLine）。
// 每次登录起一个专用的短命 rpc-ui：command_output 没有请求 id，放在服务进程上会和卡片的其他命令（列表、测试）串台；
// 专用进程也让"取消"就是关掉它。凭据由 omp 写进用户真实的 agent 目录（登录本来就是要写），这里不碰。
// 不 import electron：起进程的方式由调用方注入（mcp-reauth-instance.ts），单元测试用假连接。
import { stripAnsi } from "../../shared/ansi.ts";
import { classifyReauthLine } from "../../shared/omp-output/mcp.ts";
import type { McpReauthOutcome } from "../../shared/ipc.ts";
import type { RpcServerFrame } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { log } from "../log/log.ts";

/** omp 等浏览器回调 5 分钟；多等一会儿，它超时会自己报错，这里只兜它不说话的情况。 */
const REAUTH_TIMEOUT_MS = 6 * 60 * 1000;

/** 用到的连接能力（instance 用 OmpConnection 包一层，测试替身照这个写）。 */
export interface ReauthConnection {
  onFrame(listener: (frame: RpcServerFrame) => void): () => void;
  /** 发 `prompt`，返回应答里的 agentInvoked。 */
  prompt(message: string): Promise<boolean | undefined>;
  readonly exited: Promise<unknown>;
  close(timeoutMs?: number): Promise<unknown>;
}

export interface McpReauthDeps {
  /** 在 cwd 里起一个就绪的 rpc-ui（`--no-session`，放进 Job Object）。 */
  spawn(cwd: string): Promise<ReauthConnection>;
  /** omp 给出授权地址时（它也会自己开浏览器；没开的话用户从这里点）。 */
  onUrl(url: string): void;
  timeoutMs?: number;
}

class ReauthRun {
  readonly #outcome = Promise.withResolvers<McpReauthOutcome>();
  #connection: ReauthConnection | null = null;
  #ended = false;
  #timer: NodeJS.Timeout | undefined;

  get outcome(): Promise<McpReauthOutcome> {
    return this.#outcome.promise;
  }

  async run(deps: McpReauthDeps, name: string, cwd: string): Promise<void> {
    this.#timer = setTimeout(
      () => void this.end({ kind: "failed", message: "omp did not report a result in time" }),
      deps.timeoutMs ?? REAUTH_TIMEOUT_MS,
    );
    try {
      const connection = await deps.spawn(cwd);
      this.#connection = connection;
      if (this.#ended) {
        await connection.close(1_000);
        return;
      }
      connection.onFrame((frame) => {
        if (frame.type !== "command_output" || this.#ended) return;
        const line = classifyReauthLine(stripAnsi(frame.text));
        if (line.kind === "progress") {
          if (line.url !== null) deps.onUrl(line.url);
        } else void this.end(line);
      });
      void connection.exited.then(() => void this.end({ kind: "failed", message: "omp exited during the sign-in" }));
      const agentInvoked = await connection.prompt(`/mcp reauth ${name}`);
      if (agentInvoked !== false)
        await this.end({ kind: "failed", message: "omp did not run /mcp reauth as a builtin command" });
    } catch (error) {
      await this.end({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** 结束（有结果、取消、超时）：先关进程再给结果，调用方拿到结果时没有残留的 omp。 */
  async end(outcome: McpReauthOutcome): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#timer);
    await this.#connection?.close(1_000).catch(() => undefined);
    log.info("mcp reauth finished", { kind: outcome.kind });
    this.#outcome.resolve(outcome);
  }
}

/** 同一时间最多一次登录；新的开始前先取消旧的（对话框被关、渲染进程重载后旧的不能挡住新的）。 */
export class McpReauth {
  readonly #deps: McpReauthDeps;
  #active: ReauthRun | null = null;

  constructor(deps: McpReauthDeps) {
    this.#deps = deps;
  }

  /** 在 cwd（项目范围 = 项目目录，用户范围 = studio 自己的空目录）里登录 name；名字由调用方校验过。 */
  async start(name: string, cwd: string): Promise<McpReauthOutcome> {
    await this.cancel();
    const run = new ReauthRun();
    this.#active = run;
    void run.run(this.#deps, name, cwd);
    const outcome = await run.outcome;
    if (this.#active === run) this.#active = null;
    return outcome;
  }

  /** 取消正在进行的登录（关进程，`start` 以 cancelled 结束）；没有时什么都不做。 */
  async cancel(): Promise<void> {
    await this.#active?.end({ kind: "cancelled" });
  }
}
