// 对话流吸底的两个外部请求：输入框发送后强制吸底（spec 5.4 第 4 条）；对话线跳到前面的消息时离开吸底
// （键盘跳转没有指针按下，跳完的 scroll 事件和流式追加挤在同一帧时会被当成布局变化，又被贴回底部）。
import type { TaskId } from "../../../../shared/ipc.ts";

const listeners = new Set<(taskId: TaskId) => void>();

export function requestStickToBottom(taskId: TaskId): void {
  for (const listener of listeners) listener(taskId);
}

export function onStickToBottomRequest(listener: (taskId: TaskId) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const leaveListeners = new Set<(taskId: TaskId) => void>();

export function requestLeaveBottom(taskId: TaskId): void {
  for (const listener of leaveListeners) listener(taskId);
}

export function onLeaveBottomRequest(listener: (taskId: TaskId) => void): () => void {
  leaveListeners.add(listener);
  return () => {
    leaveListeners.delete(listener);
  };
}
