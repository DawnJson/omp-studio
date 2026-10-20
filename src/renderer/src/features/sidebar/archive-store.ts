// 归档 + 8 秒撤销。主进程的 archiveTask 会关进程并移出列表，没有"取消归档"的接口，
// 所以先在界面里把任务藏起来，8 秒内没撤销才真正调 archiveTask；窗口关闭时立刻补调，不丢归档。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { clearSelection } from "../../store/index.ts";
import { pushToast } from "../dialogs/index.ts";

const archiveUndoMs = 8000;

const hiddenStore = createStore<ReadonlySet<TaskId>>(new Set());
const timers = new Map<TaskId, number>();

function setHidden(update: (draft: Set<TaskId>) => void): void {
  const next = new Set(hiddenStore.get());
  update(next);
  hiddenStore.set(next);
}

/** 正在等待撤销、侧栏里应该藏起来的任务。 */
export function useHiddenTasks(): ReadonlySet<TaskId> {
  return useStoreValue(hiddenStore, (state) => state);
}

async function commitArchive(taskId: TaskId, t: TFunction): Promise<void> {
  timers.delete(taskId);
  try {
    await window.studio.archiveTask(taskId);
  } catch (error) {
    reportError(t, error);
  }
  // 成功时任务已从任务表移除（taskRemoved）；失败时让它重新出现在侧栏。
  setHidden((draft) => draft.delete(taskId));
}

export function archiveWithUndo(taskId: TaskId, selectedTaskId: TaskId | null, t: TFunction): void {
  if (timers.has(taskId)) return;
  setHidden((draft) => draft.add(taskId));
  if (selectedTaskId === taskId) clearSelection();
  timers.set(
    taskId,
    window.setTimeout(() => void commitArchive(taskId, t), archiveUndoMs),
  );
  pushToast({
    level: "info",
    message: t("task.archived"),
    durationMs: archiveUndoMs,
    action: {
      label: t("task.undo"),
      run() {
        const timer = timers.get(taskId);
        if (timer === undefined) return;
        window.clearTimeout(timer);
        timers.delete(taskId);
        setHidden((draft) => draft.delete(taskId));
      },
    },
  });
}

// 窗口关闭或重载时，还没到点的归档立刻提交（IPC 请求已发出，主进程会处理完）。
window.addEventListener("pagehide", () => {
  for (const [taskId, timer] of timers) {
    window.clearTimeout(timer);
    void window.studio.archiveTask(taskId);
  }
  timers.clear();
});
