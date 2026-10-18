// 会话级安全：权限请求全拒，禁用页面缩放（spec §5.1：v1 禁用 Ctrl +/-/0）。
// CSP 在 index.html 的 <meta>（构建时注入，见 electron.vite.config.ts）：file:// 页面没有响应头可改。
import { session, type WebContents } from "electron";

export function installSessionSecurity(): void {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);
}

/** 拦下 Chromium 默认的缩放快捷键。 */
export function blockZoom(webContents: WebContents): void {
  void webContents.setVisualZoomLevelLimits(1, 1);
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || input.alt) return;
    if (["+", "-", "=", "0", "_"].includes(input.key)) event.preventDefault();
  });
}
