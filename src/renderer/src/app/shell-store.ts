// 外壳界面状态：侧栏宽度、折叠、终端面板高度、历史会话排列（主进程持久化）和窄窗抽屉是否打开（只在内存）。
import { limits, type HistoryOrder, type ShellState } from "../../../shared/ipc.ts";
import { defaultTerminalHeight } from "../../../shared/ui/terminal-model.ts";
import { createStore, useStoreValue } from "../store/create-store.ts";

export const defaultSidebarWidth = 240;
export const sidebarWidthRange = [200, 360] as const;

interface ShellUiState extends ShellState {
  drawerOpen: boolean;
}

const shellStore = createStore<ShellUiState>({
  sidebarWidth: defaultSidebarWidth,
  sidebarCollapsed: false,
  terminalHeight: defaultTerminalHeight,
  historyOrder: "folder",
  drawerOpen: false,
});

export function startShellStore(): void {
  window.studio.getShellState().then(
    (state) => shellStore.set({ ...shellStore.get(), ...state }),
    (error: unknown) => console.error("getShellState 失败", error),
  );
}

function persist(patch: Partial<ShellState>): void {
  window.studio.setShellState(patch).catch((error: unknown) => console.error("setShellState 失败", error));
}

/** 拖动过程中只改内存；松手时再 persist。 */
export function previewSidebarWidth(width: number): void {
  shellStore.set({ ...shellStore.get(), sidebarWidth: clampWidth(width) });
}

export function commitSidebarWidth(width: number): void {
  const sidebarWidth = clampWidth(width);
  shellStore.set({ ...shellStore.get(), sidebarWidth });
  persist({ sidebarWidth });
}

/** 存储里只夹到合法范围；"不超过主区 70%" 取决于当时的窗口高度，由面板渲染时再夹。 */
function clampStoredTerminalHeight(height: number): number {
  return Math.round(Math.min(limits.terminalHeightRange[1], Math.max(limits.terminalHeightRange[0], height)));
}

export function previewTerminalHeight(height: number): void {
  shellStore.set({ ...shellStore.get(), terminalHeight: clampStoredTerminalHeight(height) });
}

export function commitTerminalHeight(height: number): void {
  const terminalHeight = clampStoredTerminalHeight(height);
  shellStore.set({ ...shellStore.get(), terminalHeight });
  persist({ terminalHeight });
}

export function setSidebarCollapsed(sidebarCollapsed: boolean): void {
  shellStore.set({ ...shellStore.get(), sidebarCollapsed });
  persist({ sidebarCollapsed });
}

export function setHistoryOrder(historyOrder: HistoryOrder): void {
  shellStore.set({ ...shellStore.get(), historyOrder });
  persist({ historyOrder });
}

export function setDrawerOpen(drawerOpen: boolean): void {
  shellStore.set({ ...shellStore.get(), drawerOpen });
}

export function useShellUi(): ShellUiState {
  return useStoreValue(shellStore, (state) => state);
}

function clampWidth(width: number): number {
  return Math.round(Math.min(sidebarWidthRange[1], Math.max(sidebarWidthRange[0], width)));
}
