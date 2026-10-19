// 会话树面板（`/tree`、命令面板"会话树"）的开关：同一时间只为一个任务开着。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

const openFor = createStore<TaskId | null>(null);

export function openSessionTree(taskId: TaskId): void {
  openFor.set(taskId);
}

export function closeSessionTree(): void {
  openFor.set(null);
}

export function useSessionTreeOpen(taskId: TaskId): boolean {
  return useStoreValue(openFor, (open) => open === taskId);
}
