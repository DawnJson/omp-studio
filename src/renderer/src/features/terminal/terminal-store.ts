// 终端面板的打开状态：按任务记（切到别的任务再回来，这个任务的面板还是开着、接着原来的 shell）。
// 只在内存里：重启应用后 shell 本来就没了，面板默认收起。主进程的终端不受它影响（隐藏面板不结束 shell）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface TerminalUiState {
  open: ReadonlySet<TaskId>;
  /** 用户刚点开或用快捷键打开、期待焦点进终端的任务；面板挂载后取走。 */
  focusRequest: TaskId | null;
}

const store = createStore<TerminalUiState>({ open: new Set(), focusRequest: null });

export function isTerminalOpen(taskId: TaskId): boolean {
  return store.get().open.has(taskId);
}

export function setTerminalOpen(taskId: TaskId, open: boolean, options: { focus?: boolean } = {}): void {
  const state = store.get();
  const next = new Set(state.open);
  if (open) next.add(taskId);
  else next.delete(taskId);
  store.set({ open: next, focusRequest: open && options.focus === true ? taskId : state.focusRequest });
}

/** 面板挂载时调用：这次打开是不是用户主动要求的（是才抢焦点，切换任务时挂载的不抢）。只能取一次。 */
export function takeFocusRequest(taskId: TaskId): boolean {
  const state = store.get();
  if (state.focusRequest !== taskId) return false;
  store.set({ ...state, focusRequest: null });
  return true;
}

export function useTerminalOpen(taskId: TaskId | null): boolean {
  return useStoreValue(store, (state) => taskId !== null && state.open.has(taskId));
}

// 任务归档或移除：主进程已经结束了它的终端，面板状态也丢掉。
window.studio.onTaskRemoved((taskId) => setTerminalOpen(taskId, false));
