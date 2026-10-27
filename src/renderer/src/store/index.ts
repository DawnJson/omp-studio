// 渲染进程的 store 入口：main.tsx 调一次 startStores()，组件用下面导出的 hook。
// 状态以主进程为准，这里只是事件的投影；写操作直接调 window.studio.*（结果通过事件回到 store）。
import { startOmpStore } from "./omp-store.ts";
import { startBtwStore } from "./btw-store.ts";
import { startReviewStore } from "./review-store.ts";
import { startSettingsStore } from "./settings-store.ts";
import { startTasksStore } from "./tasks-store.ts";
import { startUiStore } from "./ui-store.ts";
import { startUpdateStore } from "./update-store.ts";

export function startStores(): void {
  startTasksStore();
  startSettingsStore();
  startOmpStore();
  startUpdateStore();
  startUiStore();
  startReviewStore();
  startBtwStore();
}

export { useOmpStatus } from "./omp-store.ts";
export { currentPlatform, useAppInfo, useSettings, useSettingsSettled } from "./settings-store.ts";
export { useDownloadedVersion, useUpdateState } from "./update-store.ts";
export { getTask, useExistingTaskIds, useTask, useTasks, useTasksState } from "./tasks-store.ts";
export { useBtwRecords } from "./btw-store.ts";
export {
  clearSelection,
  clearSettingsSection,
  selectTask,
  setPaletteOpen,
  setSettingsPage,
  setSettingsQuery,
  showView,
  useMainView,
  usePaletteOpen,
  useSelectedTaskId,
  useSettingsPage,
  useSettingsQuery,
  useSettingsSection,
  type MainView,
  type SettingsPage,
  type SettingsSection,
} from "./ui-store.ts";
