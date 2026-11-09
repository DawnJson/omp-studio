// 分叉和回溯（docs/architecture/session-tree.md）：调主进程，再把那条用户消息的文字放进输入框让用户改了重发。
// 失败时抛出，由调用方报错（斜杠命令由 sendDraft 报错并把草稿放回，会话树面板弹 toast）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { answerTurnFromEnd, userCardFromEnd } from "../../../../shared/tsp/session-tree.ts";
import { selectTask } from "../../store/index.ts";
import { appendToDraft } from "../composer/draft-store.ts";
import { focusDraftEnd } from "../composer/insert-into-draft.ts";
import { peekTspDocument } from "../tsp/tsp-store.ts";
import { focusIndexFromEnd } from "./tree-focus.ts";

/**
 * `entryId` 为 null 时从最后一条用户消息分叉。分叉出的新任务被选中，输入框里是那条消息的文字。
 * 传会话条目 id（会话树面板的 `SessionTreeNode.entryId`）。
 */
export async function forkFromMessage(taskId: TaskId, entryId: string | null): Promise<void> {
  const { task, text } = await window.studio.forkTask(taskId, entryId, "before-user");
  appendToDraft(task.id, [{ text }]);
  await selectTask(task.id);
}

/** 当前分支上倒数第 `fromEnd` 条用户消息的会话条目 id（会话树面板的节点）；会话文件还没写到这条时抛错。 */
async function userEntryFromEnd(taskId: TaskId, fromEnd: number): Promise<string> {
  const { nodes } = await window.studio.getSessionTree(taskId);
  const index = focusIndexFromEnd(nodes, fromEnd);
  const entryId = index === null ? undefined : nodes[index]?.entryId;
  if (entryId === undefined) throw new Error("user message not found in the session file");
  return entryId;
}

/** 对话里的用户消息卡片（或卡片里的节点）→ 当前分支上倒数第几条用户消息（同 omp 的回退图标，userCardFromEnd）→ 会话树里的条目。 */
async function userEntryFromCard(taskId: TaskId, sf: string, cardNodeId: string): Promise<string> {
  const document = peekTspDocument(taskId);
  const fromEnd = document === null ? null : userCardFromEnd(document, sf, cardNodeId);
  if (fromEnd === null) throw new Error("user message not found");
  return userEntryFromEnd(taskId, fromEnd);
}

/** 对话里用户消息卡片上的"分叉"：卡片对应的条目走 forkFromMessage。找不到对应条目（会话文件还没写到这条）时抛错。 */
export async function forkFromUserCard(taskId: TaskId, sf: string, cardNodeId: string): Promise<void> {
  await forkFromMessage(taskId, await userEntryFromCard(taskId, sf, cardNodeId));
}

/** 对话里用户消息卡片上的"编辑"：就地回到这条消息之前（同会话树面板里选中它，branchToNode），文字进输入框、焦点给输入框。 */
export async function editUserCard(taskId: TaskId, sf: string, cardNodeId: string): Promise<void> {
  await branchToNode(taskId, await userEntryFromCard(taskId, sf, cardNodeId));
  focusDraftEnd(taskId);
}

/**
 * 回答下方用量行上的"从这里分叉"：新任务的对话到这条回答为止（含回答），输入框空着。
 * 用量行 → 它的助手容器回的是当前分支上倒数第几条用户消息（answerTurnFromEnd）→ 会话树里那条用户消息的条目，
 * 主进程再在会话文件里找它在当前分支上的回答（`after-answer`）。
 */
export async function forkAfterAnswer(taskId: TaskId, sf: string, usageNodeId: string): Promise<void> {
  const document = peekTspDocument(taskId);
  const fromEnd = document === null ? null : answerTurnFromEnd(document, sf, usageNodeId);
  if (fromEnd === null) throw new Error("answer not found");
  const { task } = await window.studio.forkTask(taskId, await userEntryFromEnd(taskId, fromEnd), "after-answer");
  await selectTask(task.id);
}

/** 就地回到树里的一个节点：对话流由主进程重推，这里只把那条消息的文字放回输入框。 */
export async function branchToNode(taskId: TaskId, entryId: string, summarize = false): Promise<void> {
  const { text } = await window.studio.branchTask(taskId, entryId, summarize);
  appendToDraft(taskId, [{ text }]);
}
