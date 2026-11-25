// 右侧预览面板的状态：同一时间只开一个（任务 id 或新任务草稿的键），里面是一排标签，每个标签是一个文件或回答里的一段代码。
// 标签按键记在内存里：关掉面板、切走任务再回来仍在；重开应用就没了。标签列表的增删规则在 preview-tabs.ts。
// 文件树在侧栏（SidebarFiles.tsx），树的展开状态按键记在 tree-state.ts。
import type { TaskId, TerminalKey } from "../../../../shared/ipc.ts";
import type { PreviewKind } from "../../markdown/code-preview.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { activateTab, addTab, removeTab, type TabList } from "./preview-tabs.ts";
import type { Snippet } from "./snippet.ts";

export type PreviewTab =
  | {
      id: number;
      kind: "file";
      /** 文件树给相对根目录的路径，链接也可以给本机绝对路径。 */
      path: string;
      /** 文件在哪个根里：缺省 = 任务目录，n = 第 n 个额外工作区目录（roots-store.ts）。 */
      root: number | undefined;
      /** 对话里的文件链接：直接只读预览（readLinkedPreviewFile），可以在工作区外。 */
      fromLink: boolean;
    }
  | { id: number; kind: "snippet"; snippet: Snippet };

type NewTab =
  | { kind: "file"; path: string; root: number | undefined; fromLink: boolean }
  | { kind: "snippet"; snippet: Omit<Snippet, "id"> };

interface PreviewState {
  /** 面板开给谁；null = 关着（标签仍按键留着）。 */
  open: TerminalKey | null;
  byKey: ReadonlyMap<TerminalKey, TabList<PreviewTab>>;
}

export interface PreviewPanel extends TabList<PreviewTab> {
  key: TerminalKey;
}

const store = createStore<PreviewState>({ open: null, byKey: new Map() });

/** 标签和片段的编号：每打开一个加一，不按内容算，不会撞。 */
let seq = 0;

/** 打开面板前拿焦点的元素；Esc/× 关闭后还给它。 */
let returnFocus: HTMLElement | null = null;

function sameTab(tab: PreviewTab, next: NewTab): boolean {
  if (tab.kind === "file" && next.kind === "file")
    return tab.path === next.path && tab.root === next.root && tab.fromLink === next.fromLink;
  return (
    tab.kind === "snippet" &&
    next.kind === "snippet" &&
    tab.snippet.kind === next.snippet.kind &&
    tab.snippet.code === next.snippet.code
  );
}

function setTabs(key: TerminalKey, tabs: TabList<PreviewTab> | null, open: TerminalKey | null): void {
  const byKey = new Map(store.get().byKey);
  if (tabs === null) byKey.delete(key);
  else byKey.set(key, tabs);
  store.set({ open, byKey });
}

/** 打开（或切到已开着的同一个）标签，面板开给 key。 */
function openTab(key: TerminalKey, next: NewTab): void {
  const state = store.get();
  if (state.open === null) {
    const active = document.activeElement;
    returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  const current = state.byKey.get(key);
  const existing = current?.tabs.find((tab) => sameTab(tab, next));
  if (current !== undefined && existing !== undefined) {
    setTabs(key, activateTab(current, existing.id), key);
    return;
  }
  seq += 1;
  const id = seq;
  const tab: PreviewTab =
    next.kind === "file" ? { id, ...next } : { id, kind: "snippet", snippet: { id, ...next.snippet } };
  setTabs(key, addTab(current, tab), key);
}

/** 对话里的文件链接：直接只读预览本机文件（可以在工作区外）。 */
export function openFilePreview(taskId: TaskId, path: string): void {
  openTab(taskId, { kind: "file", path, root: undefined, fromLink: true });
}

/** 侧栏文件树里点了文件：按树当前的根读取。 */
export function openTreeFile(key: TerminalKey, path: string, root: number): void {
  openTab(key, { kind: "file", path, root: root > 0 ? root : undefined, fromLink: false });
}

/** 回答里代码块的"在侧栏预览"：一段代码一个标签；同一段已经开着就切过去。 */
export function openSnippetPreview(key: TerminalKey, kind: PreviewKind, code: string): void {
  openTab(key, { kind: "snippet", snippet: { kind, code } });
}

export function selectPreviewTab(id: number): void {
  const { open, byKey } = store.get();
  const current = open === null ? undefined : byKey.get(open);
  if (open === null || current === undefined || current.active === id) return;
  setTabs(open, activateTab(current, id), open);
}

/** 关掉一个标签（preview-tabs.ts 的 removeTab）；最后一个关掉时整个面板关上。 */
export function closePreviewTab(id: number): void {
  const { open, byKey } = store.get();
  const current = open === null ? undefined : byKey.get(open);
  if (open === null || current === undefined) return;
  const next = removeTab(current, id);
  setTabs(open, next, open);
  if (next === null) closeFilePreview();
}

/** 关上面板（Esc、×、打开别的右栏面板）：标签留着，下次打开文件时一起回来。 */
export function closeFilePreview(): void {
  const state = store.get();
  if (state.open === null) return;
  store.set({ ...state, open: null });
  const target = returnFocus;
  returnFocus = null;
  if (target?.isConnected) target.focus();
}

// 同一份标签列表返回同一个对象：useStoreValue 按引用比较，每次读都拼新对象的话组件会在每次 store 变化时重渲染。
const panels = new WeakMap<TabList<PreviewTab>, PreviewPanel>();

export function usePreviewPanel(): PreviewPanel | null {
  return useStoreValue(store, ({ open, byKey }) => {
    const tabs = open === null ? undefined : byKey.get(open);
    if (open === null || tabs === undefined) return null;
    let panel = panels.get(tabs);
    if (panel === undefined) {
      panel = { key: open, ...tabs };
      panels.set(tabs, panel);
    }
    return panel;
  });
}

// 任务删除：它的标签一起丢；面板正开着它就关上（焦点不还，任务已经没了）。
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.onTaskRemoved((taskId) => {
    const state = store.get();
    const key = taskId as string as TerminalKey;
    if (!state.byKey.has(key) && state.open !== key) return;
    const byKey = new Map(state.byKey);
    byKey.delete(key);
    store.set({ open: state.open === key ? null : state.open, byKey });
  });
}

/** 面板宽度（px）；null = 默认占主区约 36%（CSS 里给）。只在内存，不持久化。 */
const widthStore = createStore<number | null>(null);

export function setPreviewWidth(width: number): void {
  widthStore.set(Math.round(width));
}

export function usePreviewWidth(): number | null {
  return useStoreValue(widthStore, (state) => state);
}
