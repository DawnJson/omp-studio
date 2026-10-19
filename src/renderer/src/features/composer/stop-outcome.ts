// 停止之后给用户看什么。纯函数，test/composer-stop.test.ts 覆盖：只有 abort 确实生效才说"已停止"。
import type { RestoredQueue } from "../../../../shared/ipc.ts";

export interface StopToast {
  level?: "warning";
  key:
    | "composer.stopped"
    | "composer.queueRestored"
    | "composer.stopFailed"
    | "composer.stoppedBackground"
    | "composer.imagesDropped";
  count?: number;
}

/**
 * - 这一轮没停下（`aborted: false`）：只报失败，不说"已停止"。
 * - 停下了：已停止（有排队消息则带条数）；图片太大没放回、后台任务仍会唤醒会话时各追加一条警告。
 */
export function stopToasts(restored: RestoredQueue): StopToast[] {
  if (!restored.aborted) return [{ level: "warning", key: "composer.stopFailed" }];
  const queued = restored.steering.length + restored.followUp.length;
  const toasts: StopToast[] = [];
  if (restored.imagesDropped) toasts.push({ level: "warning", key: "composer.imagesDropped" });
  toasts.push(queued > 0 ? { key: "composer.queueRestored", count: queued } : { key: "composer.stopped" });
  if (restored.backgroundWork) toasts.push({ level: "warning", key: "composer.stoppedBackground" });
  return toasts;
}
