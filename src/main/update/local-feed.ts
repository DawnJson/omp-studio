// 本机目录作更新源：electron-updater 只会走 http(s)（builder-util-runtime 的请求要 hostname），
// 所以主进程在 127.0.0.1 的随机端口上开一个只读静态服务，只提供这个目录第一层里的文件。
// 不支持 Range：用本机目录时调用方关掉差分下载（整包从本机磁盘读，差分省不了什么）。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 更新源是不是本机目录（`file://` 地址或绝对路径）；是就返回目录，http(s) 地址返回 null。 */
export function localFeedDir(source: string): string | null {
  if (source.startsWith("file:")) return fileURLToPath(source);
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || !path.isAbsolute(source) ? null : source;
}

export interface LocalFeed {
  /** 给 electron-updater generic 源用的地址，以 / 结尾。 */
  url: string;
  close(): Promise<void>;
}

async function respond(dir: string, method: string | undefined, url: string | undefined, res: ServerResponse) {
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let name: string;
  try {
    name = decodeURIComponent(new URL(url ?? "/", "http://feed").pathname.slice(1));
  } catch {
    res.writeHead(400).end();
    return;
  }
  // 只认目录第一层的普通文件名：子目录、..、盘符、反斜杠一律 404。
  if (name === "" || name.startsWith(".") || path.basename(name) !== name || /[\\/:]/.test(name)) {
    res.writeHead(404).end();
    return;
  }
  const file = path.join(dir, name);
  const info = await stat(file).catch(() => null);
  if (info === null || !info.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Length": info.size,
    "Content-Type": name.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream",
    "Cache-Control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

export async function serveFeedDir(dir: string): Promise<LocalFeed> {
  const server = createServer((req, res) => {
    respond(dir, req.method, req.url, res).catch(() => res.destroy());
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
