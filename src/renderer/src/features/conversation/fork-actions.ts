// 分叉和回溯（docs/architecture/session-tree.md）：调主进程，再把那条用户消息的文字放进输入框让用户改了重发。
// 前两个函数失败时抛出（斜杠命令由 sendDraft 报错并把草稿放回）；带 Reporting 的自己弹错误 toast，给按钮、面板用。
import { useSyncExternalStore } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { selectTask } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { appendToDraft } from "../composer/draft-store.ts";

const pending = new Set<TaskId>();
const listeners = new Set<() => void>();

function setPending(taskId: TaskId, on: boolean): void {
  if (on ? pending.has(taskId) : !pending.delete(taskId)) return;
  if (on) pending.add(taskId);
  for (const listener of listeners) listener();
}

/** 这个任务正在分叉：按钮据此禁用，避免连点（第二次点击只会得到 sessionBusy）。 */
export function useForkPending(taskId: TaskId): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending.has(taskId),
  );
}

/**
 * `userMessageKey` 为 null 时从最后一条用户消息分叉。分叉出的新任务被选中，输入框里是那条消息的文字。
 * rpc 任务传对话流里那条用户消息的 key；TSP 任务传会话条目 id（会话树面板的 `SessionTreeNode.entryId`，没有对话流 key）。
 */
export async function forkFromMessage(taskId: TaskId, userMessageKey: string | null): Promise<void> {
  setPending(taskId, true);
  try {
    const { task, text } = await window.studio.forkTask(taskId, userMessageKey);
    appendToDraft(task.id, [text]);
    await selectTask(task.id);
  } finally {
    setPending(taskId, false);
  }
}

export async function forkFromMessageReporting(
  taskId: TaskId,
  userMessageKey: string | null,
  t: TFunction,
): Promise<void> {
  try {
    await forkFromMessage(taskId, userMessageKey);
  } catch (error) {
    reportError(t, error, (message) => t("tree.forkFailed", { message }));
  }
}

/** 就地回到树里的一个节点：对话流由主进程重推，这里只把那条消息的文字放回输入框。 */
export async function branchToNode(taskId: TaskId, entryId: string, summarize = false): Promise<void> {
  const { text } = await window.studio.branchTask(taskId, entryId, summarize);
  appendToDraft(taskId, [text]);
}
