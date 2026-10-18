// 渲染进程的 store 入口：main.tsx 调一次 startStores()，组件用下面导出的 hook。
// 状态以主进程为准，这里只是事件的投影；写操作直接调 window.studio.*（结果通过事件回到 store）。
import { startOmpStore } from "./omp-store.ts";
import { startLanesStore } from "./lanes-store.ts";
import { startReviewStore } from "./review-store.ts";
import { startSettingsStore } from "./settings-store.ts";
import { startTasksStore } from "./tasks-store.ts";
import { startTranscriptStore } from "./transcript-store.ts";
import { startUiStore } from "./ui-store.ts";
import { startUpdateStore } from "./update-store.ts";

export function startStores(): void {
  startTasksStore();
  startTranscriptStore();
  startSettingsStore();
  startOmpStore();
  startUpdateStore();
  startUiStore();
  startReviewStore();
  startLanesStore();
}

export { useOmpStatus } from "./omp-store.ts";
export { useAppInfo, useSettings } from "./settings-store.ts";
export { useUpdateState } from "./update-store.ts";
export { useTask, useTasks, useTasksState, type TasksState } from "./tasks-store.ts";
export { useTranscript } from "./transcript-store.ts";
export { useLanes } from "./lanes-store.ts";
export {
  clearSelection,
  clearSettingsSection,
  selectTask,
  setPaletteOpen,
  showView,
  useMainView,
  usePaletteOpen,
  useSelectedTaskId,
  useSettingsSection,
  type MainView,
  type SettingsSection,
} from "./ui-store.ts";
