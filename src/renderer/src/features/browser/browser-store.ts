// 浏览器面板（右栏，spec §4.29）的状态：同一时间只有一个任务的面板；各任务页面的状态（地址、标题、能否前进后退）由主进程推来。
// 和文件面板、子代理面板共用右栏，同时只开一个。页面本身是主进程的 WebContentsView，这里只管开关和显示的数据。
import type { BrowserState, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { closeAgentsPanel } from "../agents/agents-store.ts";
import { closeFilePreview } from "../file-preview/preview-store.ts";

const panel = createStore<TaskId | null>(null);
const states = createStore<ReadonlyMap<TaskId, BrowserState>>(new Map());

/** 打开面板前拿焦点的元素；关闭后还给它。 */
let returnFocus: HTMLElement | null = null;
/** 这次打开要不要把焦点放进面板（AI 连上时自动打开的不要）。 */
let focusOnOpen = true;

export function setBrowserState(state: BrowserState): void {
  const next = new Map(states.get());
  next.set(state.taskId, state);
  states.set(next);
}

window.studio.onBrowserState(setBrowserState);
window.studio.onTaskRemoved((taskId) => {
  if (panel.get() === taskId) panel.set(null);
  if (!states.get().has(taskId)) return;
  const next = new Map(states.get());
  next.delete(taskId);
  states.set(next);
});

/** 打开（或切到）这个任务的浏览器面板。focus 为假（AI 连上时自动打开）：不记、不抢焦点。 */
export function openBrowserPanel(taskId: TaskId, focus = true): void {
  if (panel.get() === taskId) return;
  closeFilePreview();
  closeAgentsPanel(false);
  if (focus && panel.get() === null) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  focusOnOpen = focus;
  panel.set(taskId);
}

export function toggleBrowserPanel(taskId: TaskId): void {
  if (panel.get() === taskId) closeBrowserPanel();
  else openBrowserPanel(taskId);
}

/** `restoreFocus` 为假：别的面板正在打开并拿了焦点，不能把焦点抢回去。 */
export function closeBrowserPanel(restoreFocus = true): void {
  if (panel.get() === null) return;
  panel.set(null);
  const target = returnFocus;
  returnFocus = null;
  if (restoreFocus && target?.isConnected) target.focus();
}

export function useBrowserPanel(): TaskId | null {
  return useStoreValue(panel, (state) => state);
}

export function browserPanelTakesFocus(): boolean {
  return focusOnOpen;
}

export function useBrowserState(taskId: TaskId): BrowserState | undefined {
  return useStoreValue(states, (state) => state.get(taskId));
}
