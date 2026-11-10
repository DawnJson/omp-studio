// 外壳界面状态：侧栏宽度、折叠、终端面板高度、对话列宽度、历史会话排列、文件夹顺序（主进程持久化）和窄窗抽屉是否打开（只在内存）。
// 拖动侧栏 / 终端 / 对话列拖拽条时不经过这里：拖拽条自己直接改 DOM，松手时才 commit（一次写 store、一次持久化）。
import { limits, type HistoryOrder, type ShellState } from "../../../shared/ipc.ts";
import { defaultTerminalHeight } from "../../../shared/ui/terminal-model.ts";
import { createStore, useStoreValue } from "../store/create-store.ts";

export const defaultSidebarWidth = 240;
export const sidebarWidthRange = [200, 360] as const;

interface ShellUiState extends ShellState {
  drawerOpen: boolean;
  /** 主进程存的状态已经读回来：之前的值都是默认值，不能拿来覆盖存盘的内容（文件夹顺序）。 */
  loaded: boolean;
}

const shellStore = createStore<ShellUiState>({
  sidebarWidth: defaultSidebarWidth,
  sidebarCollapsed: false,
  terminalHeight: defaultTerminalHeight,
  historyOrder: "folder",
  conversationWidth: null,
  folderOrder: [],
  drawerOpen: false,
  loaded: false,
});

/** 只在有字段真的变了时写入：每次 set 都会通知所有订阅者（例如每次切任务都会调 setDrawerOpen(false)）。 */
function update(patch: Partial<ShellUiState>): void {
  const current = shellStore.get();
  const keys = Object.keys(patch) as (keyof ShellUiState)[];
  if (keys.every((key) => Object.is(current[key], patch[key]))) return;
  shellStore.set({ ...current, ...patch });
}

export function startShellStore(): void {
  window.studio.getShellState().then(
    (state) => update({ ...state, loaded: true }),
    (error: unknown) => console.error("getShellState 失败", error),
  );
}

function persist(patch: Partial<ShellState>): void {
  window.studio.setShellState(patch).catch((error: unknown) => console.error("setShellState 失败", error));
}

export function commitSidebarWidth(width: number): void {
  const sidebarWidth = clampSidebarWidth(width);
  update({ sidebarWidth });
  persist({ sidebarWidth });
}

/** 存储里只夹到合法范围；"不超过主区 70%" 取决于当时的窗口高度，由面板渲染时再夹。 */
function clampStoredTerminalHeight(height: number): number {
  return Math.round(Math.min(limits.terminalHeightRange[1], Math.max(limits.terminalHeightRange[0], height)));
}

export function commitTerminalHeight(height: number): void {
  const terminalHeight = clampStoredTerminalHeight(height);
  update({ terminalHeight });
  persist({ terminalHeight });
}

/** 对话列宽度（占主区的百分比，null = 默认）：夹到合法范围、留两位小数。 */
export function commitConversationWidth(ratio: number | null): void {
  const [min, max] = limits.conversationWidthRange;
  const conversationWidth = ratio === null ? null : Math.round(Math.min(max, Math.max(min, ratio)) * 100) / 100;
  update({ conversationWidth });
  persist({ conversationWidth });
}

export function setSidebarCollapsed(sidebarCollapsed: boolean): void {
  update({ sidebarCollapsed });
  persist({ sidebarCollapsed });
}

export function setHistoryOrder(historyOrder: HistoryOrder): void {
  update({ historyOrder });
  persist({ historyOrder });
}

/** 侧栏文件夹顺序（sidebar-model 的 adoptNewFolders / moveFolder 算好的整份列表）。 */
export function setFolderOrder(folderOrder: string[]): void {
  update({ folderOrder });
  persist({ folderOrder });
}

export function setDrawerOpen(drawerOpen: boolean): void {
  update({ drawerOpen });
}

/** 订阅外壳状态的一个字段：只在这个字段变了时重渲染。 */
export function useShellValue<K extends keyof ShellUiState>(key: K): ShellUiState[K] {
  return useStoreValue(shellStore, (state) => state[key]);
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(sidebarWidthRange[1], Math.max(sidebarWidthRange[0], width)));
}
