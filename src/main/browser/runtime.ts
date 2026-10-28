// 浏览器面板管理器单例和它的 Electron 接线：事件出口、退出时关掉所有页面和 CDP 口。
import type { TaskId } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { getMainWindow } from "../window/main-window.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { BrowserManager } from "./browser-manager.ts";

let manager: BrowserManager | null = null;
/** omp 进程在的任务（任务状态不是 stopped / error），由任务状态事件维护：新建的 TaskBrowser 从这里取初值。 */
const ompRunning = new Set<TaskId>();

export function getBrowserManager(): BrowserManager {
  if (manager !== null) return manager;
  const created = new BrowserManager({
    window: getMainWindow,
    emitState: (state) => emitEvent("browserState", state),
    emitConnected: (taskId) => emitEvent("browserConnected", taskId),
    ompRunning: (taskId) => ompRunning.has(taskId),
  });
  registerShutdownHook(() => created.closeAll());
  manager = created;
  return created;
}

/** 任务归档或删除后调用；还没有管理器就没有页面。 */
export function closeTaskBrowser(taskId: TaskId): Promise<void> {
  ompRunning.delete(taskId);
  return manager?.close(taskId) ?? Promise.resolve();
}

/** 任务状态变了时调用：omp 进程不在（stopped / error）、面板关着、没有 CDP 客户端的页面关掉（docs/architecture/browser.md）。 */
export function setTaskBrowserOmpRunning(taskId: TaskId, running: boolean): void {
  if (running) ompRunning.add(taskId);
  else ompRunning.delete(taskId);
  manager?.setOmpRunning(taskId, running);
}
