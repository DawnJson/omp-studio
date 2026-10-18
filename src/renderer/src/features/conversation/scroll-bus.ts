// 输入框发送后要让对话流强制吸底（spec 5.4 第 4 条）：两个功能之间只有这一个事件。
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
