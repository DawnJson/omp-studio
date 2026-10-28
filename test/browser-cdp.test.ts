// 浏览器面板的 CDP 转接（src/main/browser/cdp-bridge.ts + cdp-server.ts）：omp（puppeteer）连上来时看到的目标、
// 命令落到哪个页面会话、不准关用户的页面、网页里发起的连接被挡在外面。
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CdpBridge, type CdpBridgeHost, type CdpClient, type CdpPage } from "../src/main/browser/cdp-bridge.ts";
import { startCdpServer, type CdpServer } from "../src/main/browser/cdp-server.ts";

const VERSIONS = { chrome: "140.0.0.0", v8: "14.0" };

interface Sent {
  method: string;
  params: Record<string, unknown>;
  sessionId: string | undefined;
}

class FakePage implements CdpPage {
  readonly tabId = "TAB1";
  readonly pageId = "PAGE1";
  readonly sent: Sent[] = [];
  readonly navigated: string[] = [];
  released = 0;
  title(): string {
    return "Home";
  }
  url(): string {
    return "https://example.com/";
  }
  send(method: string, params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown> {
    this.sent.push({ method, params, sessionId });
    return Promise.resolve({ echoed: method });
  }
  navigate(url: string): void {
    this.navigated.push(url);
  }
  release(): void {
    this.released += 1;
  }
}

function setup() {
  let page: FakePage | null = null;
  let connected = 0;
  const host: CdpBridgeHost = {
    page: (create) => {
      if (page === null && create) page = new FakePage();
      return page;
    },
    connected: () => {
      connected += 1;
    },
  };
  const bridge = new CdpBridge(host, VERSIONS);
  const inbox: Record<string, unknown>[] = [];
  const client: CdpClient = { send: (message) => inbox.push(message as Record<string, unknown>) };
  const connection = bridge.connect(client);
  let nextId = 0;
  const call = async (method: string, params: object = {}, sessionId?: string) => {
    nextId += 1;
    const id = nextId;
    await connection.receive(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return inbox.find((message) => message["id"] === id)!;
  };
  /** 照 puppeteer 25 的连法：根会话 setAutoAttach 拿到 tab 会话，tab 会话里再 setAutoAttach 拿到 page 会话。 */
  const handshake = async () => {
    await call("Target.setDiscoverTargets", { discover: true, filter: [{}] });
    await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const tab = inbox.find(
      (message) =>
        message["method"] === "Target.attachedToTarget" &&
        (message["params"] as { targetInfo: { type: string } }).targetInfo.type === "tab",
    )!;
    const tabSession = (tab["params"] as { sessionId: string }).sessionId;
    await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, tabSession);
    const pageAttach = inbox.find(
      (message) =>
        message["method"] === "Target.attachedToTarget" &&
        (message["params"] as { targetInfo: { type: string } }).targetInfo.type === "page",
    )!;
    return {
      tabSession,
      pageSession: (pageAttach["params"] as { sessionId: string }).sessionId,
      pageAttachParent: pageAttach["sessionId"],
    };
  };
  return { bridge, connection, inbox, call, handshake, page: () => page!, connected: () => connected };
}

describe("CdpBridge", () => {
  it("omp 连上来就有页面，并通知面板 AI 开始用浏览器", () => {
    const { page, connected } = setup();
    expect(page()).not.toBeNull();
    expect(connected()).toBe(1);
  });

  it("puppeteer 的连法：tab 会话挂在根上，page 会话挂在 tab 会话下，页面命令转给页面的根会话", async () => {
    const { call, handshake, page } = setup();
    const { tabSession, pageSession, pageAttachParent } = await handshake();
    expect(pageAttachParent).toBe(tabSession);
    const reply = await call("Runtime.evaluate", { expression: "1+1" }, pageSession);
    expect(reply).toMatchObject({ result: { echoed: "Runtime.evaluate" }, sessionId: pageSession });
    expect(page().sent).toEqual([{ method: "Runtime.evaluate", params: { expression: "1+1" }, sessionId: undefined }]);
  });

  it("页面里的子会话（iframe、worker）的命令带着它自己的会话 id 转给页面", async () => {
    const { call, handshake, page } = setup();
    await handshake();
    await call("Runtime.enable", {}, "CHILD-SESSION");
    expect(page().sent.at(-1)).toEqual({ method: "Runtime.enable", params: {}, sessionId: "CHILD-SESSION" });
  });

  it("页面事件：根会话的事件换成客户端的 page 会话 id，子会话的事件保留原 id", async () => {
    const { bridge, inbox, handshake } = setup();
    const { pageSession } = await handshake();
    bridge.pageEvent("Page.loadEventFired", { timestamp: 1 }, undefined);
    bridge.pageEvent("Runtime.consoleAPICalled", {}, "CHILD");
    expect(inbox.slice(-2)).toEqual([
      { method: "Page.loadEventFired", params: { timestamp: 1 }, sessionId: pageSession },
      { method: "Runtime.consoleAPICalled", params: {}, sessionId: "CHILD" },
    ]);
  });

  it("关页面、关浏览器的命令不执行，从哪一级发来都一样", async () => {
    const { call, handshake, page } = setup();
    const { pageSession } = await handshake();
    for (const [method, session] of [
      ["Browser.close", undefined],
      ["Target.closeTarget", undefined],
      ["Page.close", pageSession],
    ] as const) {
      const reply = await call(method, { targetId: "PAGE1" }, session);
      expect(reply["error"]).toMatchObject({ code: -32000 });
    }
    expect(page().sent).toEqual([]);
  });

  it("新开页面 = 在面板的页面里打开地址", async () => {
    const { call, page } = setup();
    const reply = await call("Target.createTarget", { url: "https://example.org/" });
    expect(reply["result"]).toEqual({ targetId: "PAGE1" });
    expect(page().navigated).toEqual(["https://example.org/"]);
  });

  it("最后一个 page 会话断开后摘掉页面的 debugger（omp 设的仿真不留在面板里）", async () => {
    const { connection, handshake, page } = setup();
    await handshake();
    expect(page().released).toBe(0);
    connection.disconnect();
    expect(page().released).toBe(1);
  });

  it("页面没了：会话断开，发现了目标的客户端收到销毁通知", async () => {
    const { bridge, inbox, handshake, page } = setup();
    const { pageSession } = await handshake();
    bridge.pageDestroyed(page());
    const methods = inbox.slice(-4).map((message) => message["method"]);
    expect(methods).toEqual([
      "Target.detachedFromTarget",
      "Target.detachedFromTarget",
      "Target.targetDestroyed",
      "Target.targetDestroyed",
    ]);
    expect(inbox.some((message) => (message["params"] as { sessionId?: string })?.sessionId === pageSession)).toBe(
      true,
    );
  });
});

describe("startCdpServer", () => {
  let server: CdpServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      http
        .get(url, { headers }, (response) => {
          let body = "";
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        })
        .on("error", reject);
    });
  }

  async function start() {
    const { bridge, page } = setup();
    server = await startCdpServer(bridge, VERSIONS);
    return { url: server.url, page };
  }

  it("只听 127.0.0.1；/json/version 给出带 token 的 WebSocket 地址，用它能收发 CDP", async () => {
    const { url } = await start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const version = await get(`${url}/json/version`);
    expect(version.status).toBe(200);
    const ws = (JSON.parse(version.body) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    expect(ws).toMatch(/\/devtools\/browser\/[0-9a-f-]{36}$/);
    const socket = new WebSocket(ws);
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.getVersion" })));
      socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data)) as Record<string, unknown>));
      socket.addEventListener("error", () => reject(new Error("websocket error")));
    });
    socket.close();
    expect(reply).toMatchObject({ id: 1, result: { product: "Chrome/140.0.0.0" } });
  });

  it("网页里发起的请求（带 Origin）和换了 Host 的请求（DNS rebinding）被拒", async () => {
    const { url } = await start();
    expect((await get(`${url}/json/version`, { origin: "https://evil.example" })).status).toBe(403);
    expect((await get(`${url}/json/version`, { host: "evil.example" })).status).toBe(403);
  });

  it("猜不到 token 的 WebSocket 连不上", async () => {
    const { url } = await start();
    const socket = new WebSocket(`${url.replace("http", "ws")}/devtools/browser/guess`);
    const outcome = await new Promise<string>((resolve) => {
      socket.addEventListener("open", () => resolve("open"));
      socket.addEventListener("error", () => resolve("error"));
    });
    expect(outcome).toBe("error");
  });
});
