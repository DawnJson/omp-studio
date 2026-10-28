// 浏览器面板对 omp 开的 CDP 口：每个任务一个，只听 127.0.0.1 的随机端口。
// 放行条件：Host 头是这个口本身（挡 DNS rebinding），请求没有 Origin 头（网页里发起的请求都带，omp 的 puppeteer 不带，
// 实测 omp 18.13.1），WebSocket 路径带只在 /json/version 里给出的随机 token。不 import electron。
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { CdpBridge } from "./cdp-bridge.ts";
import { acceptWebSocket } from "./websocket.ts";

export interface CdpServer {
  /** 给 omp 的 `browser.cdpUrl`：`http://127.0.0.1:<端口>`。 */
  readonly url: string;
  close(): Promise<void>;
}

function allowed(request: http.IncomingMessage, port: number): boolean {
  const host = request.headers.host;
  return request.headers.origin === undefined && (host === `127.0.0.1:${port}` || host === `localhost:${port}`);
}

export async function startCdpServer(bridge: CdpBridge, versions: { chrome: string; v8: string }): Promise<CdpServer> {
  const token = randomUUID();
  const server = http.createServer((request, response) => {
    const { port } = server.address() as AddressInfo;
    if (!allowed(request, port)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "GET" && request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          Browser: `Chrome/${versions.chrome}`,
          "Protocol-Version": "1.3",
          "User-Agent": `Chrome/${versions.chrome}`,
          "V8-Version": versions.v8,
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${token}`,
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new Set<{ close(): void }>();
  server.on("upgrade", (request, socket, head) => {
    const { port } = server.address() as AddressInfo;
    if (!allowed(request, port) || request.url !== `/devtools/browser/${token}`) {
      socket.destroy();
      return;
    }
    acceptWebSocket(request, socket, head, (peer) => {
      sockets.add(peer);
      const connection = bridge.connect({ send: (message) => peer.send(JSON.stringify(message)) });
      return {
        message: (text) => void connection.receive(text),
        closed: () => {
          sockets.delete(peer);
          connection.disconnect();
        },
      };
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const peer of sockets) peer.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
