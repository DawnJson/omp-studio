// 把主窗口带回前台：隐藏在托盘的窗口淡入显示，最小化的先还原；窗口不在了（渲染进程崩溃后被销毁等）就重新创建，
// 新窗口和启动时一样等渲染进程第一帧画完再淡入（main-window.ts 的 revealOnFirstFrame）。
// 托盘点击、第二个实例、系统通知和 macOS 的 activate 都走这里。
import type { BrowserWindow } from "electron";
import { createMainWindow, getMainWindow, revealWindow } from "./main-window.ts";

export function showMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  if (existing === null) return createMainWindow();
  if (existing.isMinimized()) existing.restore();
  revealWindow(existing);
  existing.focus();
  return existing;
}
