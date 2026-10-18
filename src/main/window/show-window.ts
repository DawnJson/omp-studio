// 把主窗口带回前台：隐藏在托盘的窗口先显示，最小化的先还原；窗口不在了（渲染进程崩溃后被销毁等）就重新创建。
// 托盘点击、第二个实例、系统通知和 macOS 的 activate 都走这里。
import type { BrowserWindow } from "electron";
import { createMainWindow, getMainWindow } from "./main-window.ts";

export function showMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  const window = existing ?? createMainWindow();
  if (existing) {
    if (window.isMinimized()) window.restore();
    window.show();
  }
  window.focus();
  return window;
}
