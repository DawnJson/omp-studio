// 自定义协议 app://studio/：只提供 out/renderer 里的文件，以及 app://studio/@backdrop/<文件名>（userData/backdrops 里的自选背景图）。
// file:// 下 CSP 的 'self' 等于"本机任意文件"，换成专用协议后 'self' 只剩应用自己的资源。路径穿越（../、编码的 ..、绝对路径）一律 404；
// 背景图只认 backdropFilePattern（sha256 + 图片扩展名）这种文件名，不解码、不拼子目录。
import { existsSync } from "node:fs";
import { net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { backdropFilePattern } from "../../shared/ipc.ts";
import { backdropsDir } from "../settings/backdrop-image.ts";

const appScheme = "app";
export const appOrigin = `${appScheme}://studio`;

const rendererRoot = path.join(import.meta.dirname, "..", "renderer");
const backdropPrefix = "/@backdrop/";

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** 把请求地址映射到 rendererRoot 下的文件（或 backdrops 里的背景图）；越界、文件名不合规或不是 app://studio 返回 null。 */
export function resolveAppFile(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.protocol !== `${appScheme}:` || url.host !== "studio") return null;
  if (url.pathname.startsWith(backdropPrefix)) {
    const name = url.pathname.slice(backdropPrefix.length);
    return backdropFilePattern.test(name) ? path.join(backdropsDir(), name) : null;
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(rendererRoot, relative);
  return file.startsWith(rendererRoot + path.sep) ? file : null;
}

const notFound = () => new Response("Not found", { status: 404 });

export function installAppProtocol(): void {
  protocol.handle(appScheme, async (request) => {
    const file = resolveAppFile(request.url);
    if (file === null) return notFound();
    // 文件不存在（被删掉的旧背景图、拼错的资源名）回 404，而不是让请求以网络错误失败；别的读取错误照常抛出。
    return net.fetch(pathToFileURL(file).href).catch((error: unknown) => {
      if (!existsSync(file)) return notFound();
      throw error;
    });
  });
}
