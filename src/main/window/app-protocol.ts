// 自定义协议 app://studio/：只提供 out/renderer 里的文件。file:// 下 CSP 的 'self' 等于"本机任意文件"，
// 换成专用协议后 'self' 只剩应用自己的资源。路径穿越（../、编码的 ..、绝对路径）一律 404。
import { net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appScheme = "app";
export const appOrigin = `${appScheme}://studio`;

const rendererRoot = path.join(import.meta.dirname, "..", "renderer");

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** 把请求地址映射到 rendererRoot 下的文件；越界或不是 app://studio 返回 null。 */
export function resolveAppFile(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.protocol !== `${appScheme}:` || url.host !== "studio") return null;
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(rendererRoot, relative);
  return file.startsWith(rendererRoot + path.sep) ? file : null;
}

export function installAppProtocol(): void {
  protocol.handle(appScheme, (request) => {
    const file = resolveAppFile(request.url);
    return file === null ? new Response("Not found", { status: 404 }) : net.fetch(pathToFileURL(file).href);
  });
}
