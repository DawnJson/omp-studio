// 子代理面板（右栏，spec §4.28）的状态：同一时间只有一个任务的面板，选中的子代理名；和文件面板共用右栏，同时只开一个。
// 列表数据不在这里：直接从 TSP 文档推导（shared/tsp/agent-hub.ts 的 listAgents，tsp-store 的 useTspDerived）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { closeFilePreview } from "../file-preview/preview-store.ts";

export interface AgentsPanelState {
  taskId: TaskId;
  /** 详情里看的子代理名；null = 只看列表。 */
  selected: string | null;
}

const store = createStore<AgentsPanelState | null>(null);

/** 打开面板前拿焦点的元素；关闭后还给它。 */
let returnFocus: HTMLElement | null = null;

function rememberFocus(): void {
  if (store.get() !== null) return;
  const active = document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
}

/** 打开（或切到）这个任务的子代理面板，可顺带选中一个子代理。文件面板在同一栏，先关掉。 */
export function openAgentsPanel(taskId: TaskId, name?: string): void {
  const current = store.get();
  closeFilePreview();
  rememberFocus();
  const selected = name ?? (current?.taskId === taskId ? current.selected : null);
  if (current?.taskId === taskId && current.selected === selected) return;
  store.set({ taskId, selected });
}

/** 顶栏 / 命令面板：这个任务的面板开着就关，否则打开。 */
export function toggleAgentsPanel(taskId: TaskId): void {
  if (store.get()?.taskId === taskId) closeAgentsPanel();
  else openAgentsPanel(taskId);
}

export function selectAgent(name: string | null): void {
  const current = store.get();
  if (current === null || current.selected === name) return;
  store.set({ ...current, selected: name });
}

/** `restoreFocus` 为假：文件面板正在打开并拿了焦点，不能把焦点抢回去。 */
export function closeAgentsPanel(restoreFocus = true): void {
  if (store.get() === null) return;
  store.set(null);
  const target = returnFocus;
  returnFocus = null;
  if (restoreFocus && target?.isConnected) target.focus();
}

export function useAgentsPanel(): AgentsPanelState | null {
  return useStoreValue(store, (state) => state);
}
