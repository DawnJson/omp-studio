// 右侧文件预览的状态：同一时间只有一个预览（taskId + 路径）；关闭时把焦点还给打开它的元素。
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface PreviewTarget {
  taskId: TaskId;
  /** 调用方给的路径（相对任务 cwd，或落在 cwd 内的绝对路径）。 */
  path: string;
}

const store = createStore<PreviewTarget | null>(null);

/** 打开预览前拿焦点的元素；Esc/× 关闭后还给它。 */
let returnFocus: HTMLElement | null = null;

export function openFilePreview(taskId: TaskId, path: string): void {
  const current = store.get();
  if (current === null) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  if (current?.taskId === taskId && current.path === path) return;
  store.set({ taskId, path });
}

export function closeFilePreview(): void {
  if (store.get() === null) return;
  store.set(null);
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) target.focus();
}

export function useFilePreview(): PreviewTarget | null {
  return useStoreValue(store, (state) => state);
}

/** 面板宽度（px）；null = 默认占主区约 45%（CSS 里给）。只在内存，不持久化。 */
const widthStore = createStore<number | null>(null);

export function setPreviewWidth(width: number): void {
  widthStore.set(Math.round(width));
}

export function usePreviewWidth(): number | null {
  return useStoreValue(widthStore, (state) => state);
}
