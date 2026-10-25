// 分叉和回溯（docs/architecture/session-tree.md）：调主进程，再把那条用户消息的文字放进输入框让用户改了重发。
// 失败时抛出，由调用方报错（斜杠命令由 sendDraft 报错并把草稿放回，会话树面板弹 toast）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { selectTask } from "../../store/index.ts";
import { appendToDraft } from "../composer/draft-store.ts";

/**
 * `entryId` 为 null 时从最后一条用户消息分叉。分叉出的新任务被选中，输入框里是那条消息的文字。
 * 传会话条目 id（会话树面板的 `SessionTreeNode.entryId`）。
 */
export async function forkFromMessage(taskId: TaskId, entryId: string | null): Promise<void> {
  const { task, text } = await window.studio.forkTask(taskId, entryId);
  appendToDraft(task.id, [{ text }]);
  await selectTask(task.id);
}

/** 就地回到树里的一个节点：对话流由主进程重推，这里只把那条消息的文字放回输入框。 */
export async function branchToNode(taskId: TaskId, entryId: string, summarize = false): Promise<void> {
  const { text } = await window.studio.branchTask(taskId, entryId, summarize);
  appendToDraft(taskId, [{ text }]);
}
