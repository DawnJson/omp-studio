// 跨功能的界面状态：当前选中的任务、主区域显示什么、命令面板开关。
// 选中任务时调 openTask（需要时拉起 omp 并恢复会话），把返回的快照放进对话流镜像。
import type { TaskId } from "../../../shared/ipc.ts";
import { createStore, useStoreValue } from "./create-store.ts";
import { applyTranscriptSnapshot } from "./transcript-store.ts";

export type MainView = "conversation" | "settings";

/** 设置页的分节；命令面板用它直接定位。"shortcuts" 是通用页里的快捷键卡片；`cfg:<tab>` 是 omp 自己的设置分组。 */
export type SettingsSection = "general" | "models" | "omp" | "shortcuts" | `cfg:${string}`;

interface UiState {
  selectedTaskId: TaskId | null;
  view: MainView;
  paletteOpen: boolean;
  /** 打开设置页时要定位到的分节；设置页处理完调 clearSettingsSection。 */
  settingsSection: SettingsSection | null;
}

const uiStore = createStore<UiState>({
  selectedTaskId: null,
  view: "conversation",
  paletteOpen: false,
  settingsSection: null,
});

/** 切到某个任务并回到对话视图。openTask 失败时 reject（任务自己的 error 状态由 taskState 事件带来），选中状态保留。 */
export async function selectTask(taskId: TaskId): Promise<void> {
  uiStore.set({ ...uiStore.get(), selectedTaskId: taskId, view: "conversation" });
  const snapshot = await window.studio.openTask(taskId);
  applyTranscriptSnapshot(snapshot);
}

export function clearSelection(): void {
  uiStore.set({ ...uiStore.get(), selectedTaskId: null });
}

export function showView(view: MainView, options: { section?: SettingsSection } = {}): void {
  uiStore.set({ ...uiStore.get(), view, settingsSection: view === "settings" ? (options.section ?? null) : null });
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
