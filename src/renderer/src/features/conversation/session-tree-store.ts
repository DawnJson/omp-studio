// 会话树面板（`/tree`、命令面板"会话树"、TSP 对话里用户消息的"回退"图标）的开关：同一时间只为一个任务开着。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

const openFor = createStore<TaskId | null>(null);
/** 从"回退"图标打开时要对准的那条用户消息（当前分支上倒数第几条）；面板读走就清掉。 */
let pendingFocus: number | null = null;

/** `focusFromEnd`：当前分支上倒数第几条用户消息（0 = 最后一条）；不传就停在当前位置。 */
export function openSessionTree(taskId: TaskId, focusFromEnd?: number): void {
  pendingFocus = focusFromEnd ?? null;
  openFor.set(taskId);
}

/** 面板加载好节点后取一次对准的位置。 */
export function takeSessionTreeFocus(): number | null {
  const focus = pendingFocus;
  pendingFocus = null;
  return focus;
}

export function closeSessionTree(): void {
  openFor.set(null);
}

export function useSessionTreeOpen(taskId: TaskId): boolean {
  return useStoreValue(openFor, (open) => open === taskId);
}
