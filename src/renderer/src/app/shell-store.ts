// 外壳界面状态：侧栏宽度、折叠、侧栏文件区（展开、高度占比）、终端面板高度、对话列宽度、历史会话排列、文件夹顺序、任务标签（主进程持久化）和窄窗抽屉是否打开（只在内存）。
// 拖动侧栏 / 终端 / 对话列拖拽条时不经过这里：拖拽条自己直接改 DOM，松手时才 commit（一次写 store、一次持久化）。
import { limits, type HistoryOrder, type ShellState, type TaskId } from "../../../shared/ipc.ts";
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
  sidebarFilesOpen: true,
  sidebarFilesShare: null,
  openTabs: [],
  activeTab: null,
  taskColors: {},
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

/** 侧栏下半的文件区展开 / 收起。 */
export function setSidebarFilesOpen(sidebarFilesOpen: boolean): void {
  update({ sidebarFilesOpen });
  persist({ sidebarFilesOpen });
}

/** 没拖过：侧栏列表和文件区各占一半。 */
export const defaultSidebarFilesShare = 50;

/** 文件区高度占比（百分比，null = 默认各占一半）：夹到合法范围、取整。 */
export function commitSidebarFilesShare(share: number | null): void {
  const [min, max] = limits.sidebarFilesShareRange;
  const sidebarFilesShare = share === null ? null : Math.round(Math.min(max, Math.max(min, share)));
  update({ sidebarFilesShare });
  persist({ sidebarFilesShare });
}

export function setDrawerOpen(drawerOpen: boolean): void {
  update({ drawerOpen });
}

/** 任务标签（features/tabs）：整份列表和当前标签一起写。 */
export function setTaskTabs(openTabs: TaskId[], activeTab: TaskId | null): void {
  update({ openTabs, activeTab });
  persist({ openTabs, activeTab });
}

export function getTaskTabs(): { openTabs: TaskId[]; activeTab: TaskId | null } {
  const { openTabs, activeTab } = shellStore.get();
  return { openTabs, activeTab };
}

/** 任务颜色（标签和侧栏任务行的竖色条）：整份写。 */
export function setTaskColors(taskColors: Record<TaskId, number>): void {
  update({ taskColors });
  persist({ taskColors });
}

export function getTaskColors(): Record<TaskId, number> {
  return shellStore.get().taskColors;
}

/** 订阅外壳状态的一个字段：只在这个字段变了时重渲染。 */
export function useShellValue<K extends keyof ShellUiState>(key: K): ShellUiState[K] {
  return useStoreValue(shellStore, (state) => state[key]);
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(sidebarWidthRange[1], Math.max(sidebarWidthRange[0], width)));
}
