// 应用页面里的子框架（iframe）：文件预览的网页（studio-preview://，preview-protocol.ts）和回答里 omp 内嵌的网页
// （TSP `web` 节点，http/https，渲染进程 features/tsp/nodes/web.tsx）。两种都是沙箱 iframe，拿不到 preload（主窗口没开
// nodeIntegrationInSubFrames，preload 只进主框架），权限一律拒绝（security.ts 只放行主框架）。这里管两件 sandbox 管不到的事：
// - 导航：sandbox 不拦 iframe 导航它自己。子框架按它现在停在哪里决定能去哪里（frameNavigationAllowed）。
// - Esc：焦点在网页里时按键到不了应用页面（跨进程的子框架），网页"按 Esc 离开"靠主进程看见这个键后通知渲染进程。
import type { WebContents } from "electron";
import { previewScheme } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);
const isBlank = (url: string): boolean => url === "" || url === "about:blank" || url === "about:srcdoc";

/**
 * 子框架从 `current` 导航到 `target` 放不放行：
 * - 停在预览网页（studio-preview:）上的只能留在预览网页、about:blank / about:srcdoc（预览页面点链接、改 location 想换成外部网页时拦下）；
 * - 停在网页（http/https）上的只能去别的网页（内嵌网页里点链接照常走，不能换成 file:、studio-preview:、app: 等）；
 * - 刚建的框架（空、about:blank）可以去这三类之一；其余（file:、javascript:、data:…）一律拦。
 */
export function frameNavigationAllowed(current: string, target: string): boolean {
  const preview = (url: string) => url.startsWith(`${previewScheme}:`);
  if (preview(current)) return preview(target) || isBlank(target);
  if (isWeb(current)) return isWeb(target);
  if (isBlank(current)) return preview(target) || isBlank(target) || isWeb(target);
  return false;
}

/** 主窗口里子框架的导航守卫。新开窗口不用管：sandbox 不给 allow-popups，主窗口的 setWindowOpenHandler 也一律拒绝；改顶层页面由
 * sandbox（没有 allow-top-navigation）和主窗口的 will-navigate 拦。 */
export function guardFrames(webContents: WebContents): void {
  webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    if (!frameNavigationAllowed(details.frame?.url ?? "", details.url)) details.preventDefault();
  });
}

/**
 * 焦点在子框架里时按了 Esc（不带修饰键）：发 `frameEscape`，渲染进程里焦点所在的那个内嵌网页退回不可交互的状态。
 * 不拦这个键：网页自己可能也要用 Esc。
 */
export function relayFrameEscape(webContents: WebContents): void {
  webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown" || input.key !== "Escape") return;
    if (input.control || input.alt || input.shift || input.meta) return;
    const focused = webContents.focusedFrame;
    if (focused === null || focused.frameTreeNodeId === webContents.mainFrame.frameTreeNodeId) return;
    emitEvent("frameEscape", null);
  });
}
