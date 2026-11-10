// 文件预览里的网页（HTML 文件、回答里的 html 片段）：放在独立协议 studio-preview://<token>/ 上，做法同 Claude 的 artifact。
// srcdoc 的 iframe 继承应用页面的 CSP（script-src 'self'），勾了"运行脚本"内联脚本也不跑；放宽应用 CSP 又等于给整个应用开内联脚本。
// 换成独立的源后，页面的 CSP 只来自这里的响应头，页面自己的 <meta> 只能再收紧：脚本可以跑，但不能联网（connect-src 'none'，
// 外部脚本、图片、样式都加载不了），只能被应用页面嵌入（frame-ancestors）。iframe 的 sandbox 不给 allow-same-origin，
// 页面的源是不透明的，碰不到应用页面（parent.document 抛跨域错误）。
// 网页只放在主进程内存里，按 crypto.randomUUID() 的 token 取：不写盘；渲染进程放手、主窗口重载或关闭时删掉，之后同一地址 404。
import { randomUUID } from "node:crypto";
import { protocol, type WebContents } from "electron";
import { htmlPreviewScheme } from "../../shared/ipc.ts";
import { rendererEntryUrl } from "./app-protocol.ts";

const pages = new Map<string, string>();

/**
 * 预览网页的 CSP（响应头，页面改不了）。frame-ancestors 是应用页面的源：打包后 app://studio，开发服务器时是它的源
 * （自己拼：Node 的 URL 对非特殊协议的 origin 给 "null"）。
 */
export function previewCsp(): string {
  const entry = new URL(rendererEntryUrl());
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${entry.protocol}//${entry.host}`,
  ].join("; ");
}

export function registerPreview(html: string): string {
  const token = randomUUID();
  pages.set(token, html);
  return token;
}

export function releasePreview(token: string): void {
  pages.delete(token);
}

/** 应用页面没了（主窗口重载、关闭）：它登记的网页都不会再有人放手，一起删掉。 */
export function releaseAllPreviews(): void {
  pages.clear();
}

const notFound = () => new Response("Not found", { status: 404 });

/** 只认 GET studio-preview://<已登记的 token>/；其余（子路径、别的方法、放手过的 token）404。 */
export function previewResponse(request: Request): Response {
  const url = new URL(request.url);
  const html = url.protocol === `${htmlPreviewScheme}:` && url.pathname === "/" ? pages.get(url.host) : undefined;
  if (request.method !== "GET" || html === undefined) return notFound();
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": previewCsp(),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function installPreviewProtocol(): void {
  protocol.handle(htmlPreviewScheme, previewResponse);
}

/**
 * 子框架只许停在预览网页上：预览页面点链接、改 location 想把自己换成外部网页时拦下（sandbox 不拦 iframe 导航自己）。
 * 新开窗口不用管：sandbox 不给 allow-popups，主窗口的 setWindowOpenHandler 也一律拒绝；改顶层页面由 sandbox（没有 allow-top-navigation）
 * 和主窗口的 will-navigate 拦。
 */
export function guardPreviewFrames(webContents: WebContents): void {
  webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const { url } = details;
    if (!url.startsWith(`${htmlPreviewScheme}:`) && url !== "about:blank" && url !== "about:srcdoc")
      details.preventDefault();
  });
}
