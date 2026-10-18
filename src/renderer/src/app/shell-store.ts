// 外壳界面状态：侧栏宽度、折叠（主进程持久化）和窄窗抽屉是否打开（只在内存）。
import type { ShellState } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../store/create-store.ts";

export const defaultSidebarWidth = 264;
export const sidebarWidthRange = [220, 360] as const;

interface ShellUiState extends ShellState {
  drawerOpen: boolean;
}

const shellStore = createStore<ShellUiState>({
  sidebarWidth: defaultSidebarWidth,
  sidebarCollapsed: false,
  collapsedProjects: [],
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

export function setSidebarCollapsed(sidebarCollapsed: boolean): void {
  shellStore.set({ ...shellStore.get(), sidebarCollapsed });
  persist({ sidebarCollapsed });
}

export function setCollapsedProjects(collapsedProjects: string[]): void {
  shellStore.set({ ...shellStore.get(), collapsedProjects });
  persist({ collapsedProjects });
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
