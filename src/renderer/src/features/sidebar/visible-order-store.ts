// 侧栏当前画出来的任务（从上到下）：Ctrl 1…9 和任务循环切换要和眼前看到的顺序一致。由 Sidebar 发布，App 在按键时读。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore } from "../../store/create-store.ts";

const store = createStore<readonly TaskId[]>([]);

/** ids 内容没变就不发布，避免无谓重渲染。 */
export function publishVisibleTaskIds(ids: readonly TaskId[]): void {
  const current = store.get();
  if (current.length === ids.length && current.every((id, index) => id === ids[index])) return;
  store.set(ids);
}

export function getVisibleTaskIds(): readonly TaskId[] {
  return store.get();
}
