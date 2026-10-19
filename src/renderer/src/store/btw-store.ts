// 旁路提问（/btw）的镜像：每个任务一份记录列表。主进程是权威（TaskRunner 用同一个 applyBtwEvent 推进），
// 这里只做投影：btw 事件逐条推进，getBtw 的快照整份替换（打开面板时对齐：重载渲染进程、进程刚恢复时事件可能已经错过）。
import type { TaskId } from "../../../shared/ipc.ts";
import { applyBtwEvent, type BtwHistoryRecord } from "../../../shared/btw.ts";
import { createStore, useStoreValue } from "./create-store.ts";

const btwStore = createStore<Readonly<Record<string, readonly BtwHistoryRecord[]>>>({});
const noRecords: readonly BtwHistoryRecord[] = [];

export function startBtwStore(): void {
  window.studio.onBtw(({ taskId, event }) => {
    const state = btwStore.get();
    btwStore.set({ ...state, [taskId]: applyBtwEvent(state[taskId] ?? noRecords, event) });
  });
  window.studio.onTaskRemoved((taskId) => {
    const { [taskId]: _removed, ...rest } = btwStore.get();
    btwStore.set(rest);
  });
}

/** 向主进程要一份快照并整份替换（有进程时主进程会先读 get_btw_history）。 */
export async function refreshBtw(taskId: TaskId): Promise<void> {
  const records = await window.studio.getBtw(taskId);
  btwStore.set({ ...btwStore.get(), [taskId]: applyBtwEvent(noRecords, { type: "records", records }) });
}

export function useBtwRecords(taskId: TaskId): readonly BtwHistoryRecord[] {
  return useStoreValue(btwStore, (state) => state[taskId] ?? noRecords);
}
