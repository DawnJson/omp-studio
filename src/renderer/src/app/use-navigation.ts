// 视图导航历史栈（spec §3.1）：记录看过的视图（任务、设置、新任务空状态），后退/前进在其间切换。
// 视图状态本身在 ui-store；这里只观察它的变化来入栈，后退/前进时用 pending 标记跳过自己引起的变化。
import { reportError } from "../ui/errors.ts";
import { useT } from "../i18n/use-t.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskId } from "../../../shared/ipc.ts";
import {
  clearSelection,
  selectTask,
  showView,
  useMainView,
  useSelectedTaskId,
  useTasks,
  type MainView,
} from "../store/index.ts";

interface Entry {
  view: MainView;
  taskId: TaskId | null;
}

interface History {
  entries: Entry[];
  index: number;
}

const maxEntries = 50;

/** 两个入口算同一个视图的条件：设置页不区分任务；对话视图按任务 id，没有任务是"新任务"。 */
function keyOf(entry: Entry): string {
  return entry.view === "settings" ? "settings" : (entry.taskId ?? "new");
}

export interface Navigation {
  goBack(): void;
  goForward(): void;
}

export function useNavigation(): Navigation {
  const t = useT();
  const taskId = useSelectedTaskId();
  const view = useMainView();
  const tasks = useTasks();
  const [history, setHistory] = useState<History>({ entries: [{ view, taskId }], index: 0 });
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const current: Entry = { view, taskId };
    const key = keyOf(current);
    if (pending.current !== null) {
      if (pending.current === key) pending.current = null;
      return;
    }
    setHistory((previous) => {
      const top = previous.entries[previous.index];
      if (top && keyOf(top) === key) return previous;
      const entries = [...previous.entries.slice(0, previous.index + 1), current].slice(-maxEntries);
      return { entries, index: entries.length - 1 };
    });
  }, [view, taskId]);

  /** 目标下标：沿方向跳过已经不存在的任务。没有可去的返回 -1。 */
  const targetIndex = useCallback(
    (delta: 1 | -1): number => {
      const alive = new Set(tasks.map((task) => task.id));
      for (let i = history.index + delta; i >= 0 && i < history.entries.length; i += delta) {
        const entry = history.entries[i];
        if (entry && (entry.view === "settings" || entry.taskId === null || alive.has(entry.taskId))) return i;
      }
      return -1;
    },
    [history, tasks],
  );

  const go = useCallback(
    (delta: 1 | -1) => {
      const index = targetIndex(delta);
      const entry = history.entries[index];
      if (!entry) return;
      pending.current = keyOf(entry);
      setHistory({ ...history, index });
      if (entry.view === "settings") showView("settings");
      else if (entry.taskId !== null) selectTask(entry.taskId).catch((error: unknown) => reportError(t, error));
      else {
        clearSelection();
        showView("conversation");
      }
    },
    [history, targetIndex, t],
  );

  return {
    goBack: useCallback(() => go(-1), [go]),
    goForward: useCallback(() => go(1), [go]),
  };
}
