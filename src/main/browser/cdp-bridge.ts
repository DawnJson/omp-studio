// 浏览器面板的 CDP 转接：对 omp（puppeteer）装成一个只有一个标签页的 Chrome，页面级命令转给 WebContentsView 的
// webContents.debugger。不 import electron，单元测试用假页面。
// 目标模型照 Chrome（puppeteer 25 用的 tab 目标）：每个页面有一个 `tab` 目标和一个 `page` 目标，客户端先挂上 tab，
// 再在 tab 会话里 setAutoAttach 拿到 page 会话；之后的页面命令带 page 会话的 id。设计和实测见 docs/architecture/browser.md。
import { isRecord } from "../../shared/type-guards.ts";

export interface CdpPage {
  readonly tabId: string;
  readonly pageId: string;
  title(): string;
  url(): string;
  /** 转给页面的 debugger（第一次调用时挂上）；sessionId 是页面里的子会话（iframe、worker），根会话不传。 */
  send(method: string, params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown>;
  navigate(url: string): void;
  /** 没有客户端再用这个页面：摘掉 debugger，omp 设的仿真（视口、UA 等）随之失效，面板里恢复成用户看到的样子。 */
  release(): void;
}

export interface CdpBridgeHost {
  /** 当前页面；create 为真时没有就建一个（omp 连上来时必须有页面，它不会自己新建）。 */
  page(create: boolean): CdpPage | null;
  /** 有客户端连上了：AI 开始用这个浏览器。 */
  connected(): void;
  /** 最后一个客户端断开了：没有 AI 在用这个浏览器。 */
  disconnected(): void;
}

export interface CdpClient {
  send(message: object): void;
}

export interface CdpConnection {
  receive(text: string): Promise<void>;
  disconnect(): void;
}

interface ClientState {
  autoAttach: boolean;
  discover: boolean;
}

type SessionKind = "tab" | "page";

interface Session {
  client: CdpClient;
  kind: SessionKind;
}

class CdpError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/** 会关掉页面或浏览器、或另开页面的命令：面板里的页面归用户，omp 只能用、不能关；不管从哪一级发来都不执行。 */
const BLOCKED_METHODS = new Set([
  "Browser.close",
  "Browser.crash",
  "Browser.crashGpuProcess",
  "Page.close",
  "Page.crash",
  "Target.closeTarget",
  "Target.disposeBrowserContext",
]);

function notFound(method: string): CdpError {
  return new CdpError(`'${method}' wasn't found`, -32601);
}

let counter = 0;
function newSessionId(): string {
  counter += 1;
  return `STUDIO${Date.now().toString(16).toUpperCase()}${counter.toString(16).toUpperCase().padStart(8, "0")}`;
}

export class CdpBridge {
  readonly #host: CdpBridgeHost;
  readonly #product: string;
  readonly #v8: string;
  readonly #clients = new Map<CdpClient, ClientState>();
  readonly #sessions = new Map<string, Session>();

  constructor(host: CdpBridgeHost, versions: { chrome: string; v8: string }) {
    this.#host = host;
    this.#product = `Chrome/${versions.chrome}`;
    this.#v8 = versions.v8;
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  connect(client: CdpClient): CdpConnection {
    this.#clients.set(client, { autoAttach: false, discover: false });
    this.#host.page(true);
    this.#host.connected();
    return {
      receive: (text) => this.#receive(client, text),
      disconnect: () => {
        if (!this.#clients.delete(client)) return;
        for (const [id, session] of this.#sessions) if (session.client === client) this.#sessions.delete(id);
        this.#releaseIfUnused();
        if (this.#clients.size === 0) this.#host.disconnected();
      },
    };
  }

  /** 页面 debugger 的事件：子会话的事件带它自己的 sessionId 原样转发，根会话的事件换成各客户端的 page 会话 id。 */
  pageEvent(method: string, params: unknown, sessionId: string | undefined): void {
    for (const [id, session] of this.#sessions) {
      if (session.kind !== "page") continue;
      session.client.send({ method, params, sessionId: sessionId ?? id });
    }
  }

  /** 标题或地址变了。 */
  pageInfoChanged(): void {
    const page = this.#host.page(false);
    if (page === null) return;
    for (const [client, state] of this.#clients) {
      if (!state.discover) continue;
      client.send({ method: "Target.targetInfoChanged", params: { targetInfo: this.#info(page, "tab") } });
      client.send({ method: "Target.targetInfoChanged", params: { targetInfo: this.#info(page, "page") } });
    }
  }

  /** 页面没了（任务关掉、渲染进程崩溃）：所有会话断开，发现了目标的客户端收到销毁通知。 */
  pageDestroyed(page: CdpPage): void {
    for (const [id, session] of this.#sessions) {
      this.#sessions.delete(id);
      session.client.send({
        method: "Target.detachedFromTarget",
        params: { sessionId: id, targetId: session.kind === "tab" ? page.tabId : page.pageId },
      });
    }
    for (const [client, state] of this.#clients) {
      if (!state.discover) continue;
      client.send({ method: "Target.targetDestroyed", params: { targetId: page.pageId } });
      client.send({ method: "Target.targetDestroyed", params: { targetId: page.tabId } });
    }
  }

  /** 页面 debugger 被别人摘掉了：page 会话都失效。 */
  pageDetached(page: CdpPage): void {
    for (const [id, session] of this.#sessions) {
      if (session.kind !== "page") continue;
      this.#sessions.delete(id);
      session.client.send({ method: "Target.detachedFromTarget", params: { sessionId: id, targetId: page.pageId } });
    }
  }

  #info(page: CdpPage, kind: SessionKind) {
    return {
      targetId: kind === "tab" ? page.tabId : page.pageId,
      type: kind,
      title: page.title(),
      url: page.url(),
      attached: [...this.#sessions.values()].some((session) => session.kind === kind),
      canAccessOpener: false,
      browserContextId: "studio",
    };
  }

  #attach(client: CdpClient, page: CdpPage, kind: SessionKind, parent: string | undefined): string {
    const id = newSessionId();
    this.#sessions.set(id, { client, kind });
    client.send({
      method: "Target.attachedToTarget",
      params: { sessionId: id, targetInfo: this.#info(page, kind), waitingForDebugger: false },
      ...(parent === undefined ? {} : { sessionId: parent }),
    });
    return id;
  }

  #releaseIfUnused(): void {
    if ([...this.#sessions.values()].some((session) => session.kind === "page")) return;
    this.#host.page(false)?.release();
  }

  #page(): CdpPage {
    const page = this.#host.page(false);
    if (page === null) throw new CdpError("No target with given id found", -32602);
    return page;
  }

  #browserCommand(client: CdpClient, state: ClientState, method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "Browser.getVersion":
        return {
          protocolVersion: "1.3",
          product: this.#product,
          revision: "",
          userAgent: this.#product,
          jsVersion: this.#v8,
        };
      case "Target.getBrowserContexts":
        return { browserContextIds: [] };
      case "Target.setDiscoverTargets": {
        state.discover = params["discover"] === true;
        const page = this.#host.page(false);
        if (state.discover && page !== null) {
          client.send({ method: "Target.targetCreated", params: { targetInfo: this.#info(page, "tab") } });
          client.send({ method: "Target.targetCreated", params: { targetInfo: this.#info(page, "page") } });
        }
        return {};
      }
      case "Target.setAutoAttach": {
        const enable = params["autoAttach"] === true;
        const page = this.#host.page(false);
        if (enable && !state.autoAttach && page !== null) this.#attach(client, page, "tab", undefined);
        state.autoAttach = enable;
        return {};
      }
      case "Target.getTargets": {
        const page = this.#host.page(false);
        return { targetInfos: page === null ? [] : [this.#info(page, "tab"), this.#info(page, "page")] };
      }
      case "Target.getTargetInfo": {
        const page = this.#host.page(false);
        const id = params["targetId"];
        if (page !== null && (id === page.tabId || id === page.pageId))
          return { targetInfo: this.#info(page, id === page.tabId ? "tab" : "page") };
        if (id !== undefined) throw new CdpError("No target with given id found", -32602);
        return {
          targetInfo: {
            targetId: "browser",
            type: "browser",
            title: "",
            url: "",
            attached: true,
            canAccessOpener: false,
          },
        };
      }
      case "Target.attachToTarget": {
        const page = this.#page();
        const id = params["targetId"];
        if (id === page.tabId) return { sessionId: this.#attach(client, page, "tab", undefined) };
        if (id === page.pageId) return { sessionId: this.#attach(client, page, "page", undefined) };
        throw new CdpError(`No target with given id ${String(id)}`, -32602);
      }
      case "Target.detachFromTarget": {
        const id = params["sessionId"];
        if (typeof id === "string" && this.#sessions.get(id)?.client === client) this.#sessions.delete(id);
        this.#releaseIfUnused();
        return {};
      }
      case "Target.createTarget": {
        // 面板只有一个页面：新开页面就是在这个页面里打开地址（omp 连上来时用已有页面，实测不发这个命令）。
        const page = this.#host.page(true)!;
        const url = params["url"];
        if (typeof url === "string" && url !== "" && url !== "about:blank") page.navigate(url);
        return { targetId: page.pageId };
      }
      case "Target.activateTarget":
      case "Browser.setDownloadBehavior":
        return {};
      default:
        throw notFound(method);
    }
  }

  #tabCommand(client: CdpClient, sessionId: string, method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "Target.setAutoAttach": {
        const page = this.#page();
        const attached = [...this.#sessions.values()].some(
          (session) => session.kind === "page" && session.client === client,
        );
        if (params["autoAttach"] === true && !attached) this.#attach(client, page, "page", sessionId);
        return {};
      }
      case "Runtime.runIfWaitingForDebugger":
        return {};
      default:
        throw notFound(method);
    }
  }

  async #receive(client: CdpClient, text: string): Promise<void> {
    const state = this.#clients.get(client);
    if (state === undefined) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message["id"] !== "number" || typeof message["method"] !== "string") return;
    const { id, method } = message as { id: number; method: string };
    const params = isRecord(message["params"]) ? message["params"] : {};
    const sessionId = typeof message["sessionId"] === "string" ? message["sessionId"] : undefined;
    const reply = sessionId === undefined ? {} : { sessionId };
    try {
      if (BLOCKED_METHODS.has(method))
        throw new CdpError(`'${method}' is not allowed in the omp-studio browser`, -32000);
      let result: unknown;
      const session = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
      if (sessionId === undefined) result = this.#browserCommand(client, state, method, params);
      else if (session?.kind === "tab") result = this.#tabCommand(client, sessionId, method, params);
      else if (session?.kind === "page") result = await this.#page().send(method, params, undefined);
      // 不认识的会话 id：页面里的子会话（iframe、worker），原样交给页面的 debugger。
      else result = await this.#page().send(method, params, sessionId);
      client.send({ id, result: result ?? {}, ...reply });
    } catch (error) {
      const code = error instanceof CdpError ? error.code : -32000;
      const text = error instanceof Error ? error.message : String(error);
      client.send({ id, error: { code, message: text }, ...reply });
    }
  }
}
