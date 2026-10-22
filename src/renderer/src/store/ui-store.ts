// 跨功能的界面状态：当前选中的任务、主区域显示什么、命令面板开关。
// 选中任务时调 openTask（需要时拉起 omp 并恢复会话）。
import type { TaskId } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";

export type MainView = "conversation" | "settings";

/** 设置页的分节；命令面板和斜杠命令用它直接定位。"shortcuts" 是通用页里的快捷键卡片。 */
export type SettingsSection =
  | "general"
  | "models"
  | "providers"
  | "tools"
  | "context"
  | "agents"
  | "integrations"
  | "plugins"
  | "advanced"
  | "about"
  | "shortcuts";

/** 设置页左侧导航里的一节（不含 "shortcuts"）。 */
export type SettingsPage = Exclude<SettingsSection, "shortcuts">;

interface UiState {
  selectedTaskId: TaskId | null;
  view: MainView;
  paletteOpen: boolean;
  /** 打开设置页时要定位到的分节；设置页处理完调 clearSettingsSection。 */
  settingsSection: SettingsSection | null;
  /** 设置页当前节和搜索词：导航在侧栏位置、内容在主区，两处共用。 */
  settingsPage: SettingsPage;
  settingsQuery: string;
}

const uiStore = createStore<UiState>({
  selectedTaskId: null,
  view: "conversation",
  paletteOpen: false,
  settingsSection: null,
  settingsPage: "general",
  settingsQuery: "",
});

/** 切到某个任务并回到对话视图。openTask 失败时 reject（任务自己的 error 状态由 taskState 事件带来），选中状态保留。 */
export async function selectTask(taskId: TaskId): Promise<void> {
  uiStore.set({ ...uiStore.get(), selectedTaskId: taskId, view: "conversation" });
  await window.studio.openTask(taskId);
}

export function clearSelection(): void {
  uiStore.set({ ...uiStore.get(), selectedTaskId: null });
}

/** 进设置页（从对话来、或带了要定位的节）时回到那一节并清掉搜索；已在设置页里再调就保持原样。 */
export function showView(view: MainView, options: { section?: SettingsSection } = {}): void {
  const state = uiStore.get();
  const section = view === "settings" ? (options.section ?? null) : null;
  const enteringSettings = view === "settings" && (state.view !== "settings" || section !== null);
  uiStore.set({
    ...state,
    view,
    settingsSection: section,
    ...(enteringSettings
      ? { settingsPage: section === null || section === "shortcuts" ? "general" : section, settingsQuery: "" }
      : {}),
  });
}

/** 选设置页的一节：同时清掉搜索，回到这一节的内容。 */
export function setSettingsPage(page: SettingsPage): void {
  uiStore.set({ ...uiStore.get(), settingsPage: page, settingsQuery: "" });
}

export function setSettingsQuery(query: string): void {
  uiStore.set({ ...uiStore.get(), settingsQuery: query });
}

export function clearSettingsSection(): void {
  uiStore.set({ ...uiStore.get(), settingsSection: null });
}

export function setPaletteOpen(open: boolean): void {
  uiStore.set({ ...uiStore.get(), paletteOpen: open });
}

export function startUiStore(): void {
  window.studio.onTaskRemoved((taskId) => {
    if (uiStore.get().selectedTaskId === taskId) clearSelection();
  });
}

export function useSelectedTaskId(): TaskId | null {
  return useStoreValue(uiStore, (state) => state.selectedTaskId);
}

export function useMainView(): MainView {
  return useStoreValue(uiStore, (state) => state.view);
}

export function usePaletteOpen(): boolean {
  return useStoreValue(uiStore, (state) => state.paletteOpen);
}

export function useSettingsSection(): SettingsSection | null {
  return useStoreValue(uiStore, (state) => state.settingsSection);
}

export function useSettingsPage(): SettingsPage {
  return useStoreValue(uiStore, (state) => state.settingsPage);
}

export function useSettingsQuery(): string {
  return useStoreValue(uiStore, (state) => state.settingsQuery);
}
