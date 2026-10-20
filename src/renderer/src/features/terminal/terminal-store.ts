// 终端面板的打开状态：按键记（任务 id 或草稿的键；切到别的任务再回来，面板还是开着、接着原来的 shell）。
// 只在内存里：重启应用后 shell 本来就没了，面板默认收起。主进程的终端不受它影响（隐藏面板不结束 shell）。
import type { DraftKey, TaskId, TerminalKey } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface TerminalUiState {
  open: ReadonlySet<TerminalKey>;
  /** 用户刚点开或用快捷键打开、期待焦点进终端的键；面板挂载后取走。 */
  focusRequest: TerminalKey | null;
}

const store = createStore<TerminalUiState>({ open: new Set(), focusRequest: null });

export function isTerminalOpen(key: TerminalKey): boolean {
  return store.get().open.has(key);
}

export function setTerminalOpen(key: TerminalKey, open: boolean, options: { focus?: boolean } = {}): void {
  const state = store.get();
  const next = new Set(state.open);
  if (open) next.add(key);
  else next.delete(key);
  store.set({ open: next, focusRequest: open && options.focus === true ? key : state.focusRequest });
}

/** 草稿的终端交给了新建的任务：打开状态跟着走（任务的面板一出现就是开着的）。 */
export function rekeyTerminalOpen(from: DraftKey, to: TaskId): void {
  const state = store.get();
  if (!state.open.has(from)) return;
  const next = new Set(state.open);
  next.delete(from);
  next.add(to);
  store.set({ open: next, focusRequest: state.focusRequest === from ? to : state.focusRequest });
}

/** 面板挂载时调用：这次打开是不是用户主动要求的（是才抢焦点，切换任务时挂载的不抢）。只能取一次。 */
export function takeFocusRequest(key: TerminalKey): boolean {
  const state = store.get();
  if (state.focusRequest !== key) return false;
  store.set({ ...state, focusRequest: null });
  return true;
}

export function useTerminalOpen(key: TerminalKey | null): boolean {
  return useStoreValue(store, (state) => key !== null && state.open.has(key));
}

// 任务归档或移除：主进程已经结束了它的终端，面板状态也丢掉。
window.studio.onTaskRemoved((taskId) => setTerminalOpen(taskId, false));
