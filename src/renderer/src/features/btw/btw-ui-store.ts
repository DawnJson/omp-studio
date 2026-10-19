// 旁路提问面板的界面状态（每个任务一份）：开关、选中的话题、"请把焦点给输入框"的计数。
// 记录本身在 store/btw-store.ts（主进程事件的投影）；这里只有界面自己的状态，重载渲染进程后回到默认（关闭）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { refreshBtw } from "../../store/btw-store.ts";
import type { BtwSelection } from "./btw-view.ts";

export interface BtwUi {
  open: boolean;
  selection: BtwSelection;
  /** 每次要求聚焦（`/btw`、命令面板）加一：面板已经开着时也能把焦点拉回输入框。 */
  focusNonce: number;
}

const closed: BtwUi = { open: false, selection: null, focusNonce: 0 };
const uiStore = createStore<Readonly<Record<string, BtwUi>>>({});

function update(taskId: TaskId, patch: Partial<BtwUi>): void {
  const state = uiStore.get();
  uiStore.set({ ...state, [taskId]: { ...(state[taskId] ?? closed), ...patch } });
}

/** 打开面板并聚焦输入框；顺便向主进程对齐一次记录（历史随会话落盘，恢复后的任务里也有）。 */
export function openBtw(taskId: TaskId): void {
  update(taskId, { open: true, focusNonce: (uiStore.get()[taskId]?.focusNonce ?? 0) + 1 });
  refreshBtw(taskId).catch((error: unknown) => console.error("getBtw 失败", error));
}

export function closeBtw(taskId: TaskId): void {
  update(taskId, { open: false });
}

export function selectBtwTopic(taskId: TaskId, selection: BtwSelection): void {
  update(taskId, { selection });
}

export function useBtwUi(taskId: TaskId): BtwUi {
  return useStoreValue(uiStore, (state) => state[taskId] ?? closed);
}
