// 浏览器面板管理器单例和它的 Electron 接线：事件出口、退出时关掉所有页面和 CDP 口。
import type { TaskId } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { getMainWindow } from "../window/main-window.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { BrowserManager } from "./browser-manager.ts";

let manager: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (manager !== null) return manager;
  const created = new BrowserManager({
    window: getMainWindow,
    emitState: (state) => emitEvent("browserState", state),
    emitConnected: (taskId) => emitEvent("browserConnected", taskId),
  });
  registerShutdownHook(() => created.closeAll());
  manager = created;
  return created;
}

/** 任务归档或删除后调用；还没有管理器就没有页面。 */
export function closeTaskBrowser(taskId: TaskId): Promise<void> {
  return manager?.close(taskId) ?? Promise.resolve();
}
