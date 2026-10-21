// 右侧文件面板的状态：同一时间只有一个面板（任务 id 或新任务草稿的键），两页——文件树 / 预览；关闭时把焦点还给打开它的元素。
// 文件树的展开状态按键记在 tree-state.ts（面板关了、切走任务再回来仍在）。
import { parseDraftKey, type ProjectFilesTarget, type TaskId, type TerminalKey } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export type PanelPage = "files" | "preview";

export interface PanelState {
  /** 面板属于谁：任务 id，或草稿的键（`new:<项目 id>`）。 */
  key: TerminalKey;
  page: PanelPage;
  /** 预览页显示的文件：调用方给的路径（相对根目录，或落在根内的绝对路径）；还没打开过文件时为 null。 */
  path: string | null;
}

const store = createStore<PanelState | null>(null);

/** 打开面板前拿焦点的元素；Esc/× 关闭后还给它。 */
let returnFocus: HTMLElement | null = null;

function rememberFocus(): void {
  if (store.get() !== null) return;
  const active = document.activeElement;
  returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
}

/** 面板的数据来源：任务的工作目录，或草稿的项目目录（主进程按 id 查出，渲染进程不传路径）。 */
export function filesTarget(key: TerminalKey): ProjectFilesTarget {
  const draft = parseDraftKey(key);
  if (draft === undefined) return { kind: "task", taskId: key as TaskId };
  if (draft.projectId === null) throw new Error("the default folder has no files panel");
  return { kind: "project", projectId: draft.projectId };
}

/** 默认文件夹里的草稿（还没有项目）没有可浏览的目录，不显示文件面板入口。 */
export function canShowFilesPanel(key: TerminalKey): boolean {
  return parseDraftKey(key)?.projectId !== null;
}

/** 在预览页打开一个文件（工具卡上的文件链接）。 */
export function openFilePreview(taskId: TaskId, path: string): void {
  const current = store.get();
  if (current?.key === taskId && current.page === "preview" && current.path === path) return;
  rememberFocus();
  store.set({ key: taskId, page: "preview", path });
}

/** 顶栏按钮 / 快捷键：当前面板属于 key 就关掉，否则打开它的文件页。 */
export function toggleFilesPanel(key: TerminalKey): void {
  if (store.get()?.key === key) {
    closeFilePreview();
    return;
  }
  rememberFocus();
  store.set({ key, page: "files", path: null });
}

export function setPanelPage(page: PanelPage): void {
  const current = store.get();
  if (current === null || current.page === page || (page === "preview" && current.path === null)) return;
  store.set({ ...current, page });
}

/** 文件树里选了一个文件：切到预览页显示它。 */
export function previewFileInPanel(path: string): void {
  const current = store.get();
  if (current === null) return;
  store.set({ ...current, page: "preview", path });
}

export function closeFilePreview(): void {
  if (store.get() === null) return;
  store.set(null);
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) target.focus();
}

export function usePreviewPanel(): PanelState | null {
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
