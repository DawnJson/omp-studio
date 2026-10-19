// 视图导航历史栈（spec §3.1）：记录看过的视图（任务、设置、新任务空状态），后退/前进在其间切换。
// 视图状态本身在 ui-store；这里只观察它的变化来入栈，后退/前进时用 pending 标记跳过自己引起的变化。
import { reportError } from "../ui/errors.ts";
import { useT } from "../i18n/use-t.ts";
import { useCallback, useLayoutEffect, useRef } from "react";
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
  // 栈放在 ref 里、在布局阶段同步入栈：视图一提交，后退/前进就能看到这一项。放在 state 里要等
  // effect 之后的下一次渲染，刚切到设置页就按 Alt+← 会读到旧栈、什么也不做。
  const history = useRef<History>({ entries: [{ view, taskId }], index: 0 });
  const pending = useRef<string | null>(null);

  useLayoutEffect(() => {
    const current: Entry = { view, taskId };
    const key = keyOf(current);
    if (pending.current !== null) {
      if (pending.current === key) pending.current = null;
      return;
    }
    const previous = history.current;
    const top = previous.entries[previous.index];
    if (top && keyOf(top) === key) return;
    const entries = [...previous.entries.slice(0, previous.index + 1), current].slice(-maxEntries);
    history.current = { entries, index: entries.length - 1 };
  }, [view, taskId]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const { entries, index: at } = history.current;
      // 沿方向跳过已经不存在的任务。
      const alive = new Set(tasks.map((task) => task.id));
      let index = at + delta;
      while (index >= 0 && index < entries.length) {
        const candidate = entries[index];
        if (candidate && (candidate.view === "settings" || candidate.taskId === null || alive.has(candidate.taskId)))
          break;
        index += delta;
      }
      const entry = entries[index];
      if (!entry) return;
      pending.current = keyOf(entry);
      history.current = { entries, index };
      if (entry.view === "settings") showView("settings");
      else if (entry.taskId !== null) selectTask(entry.taskId).catch((error: unknown) => reportError(t, error));
      else {
        clearSelection();
        showView("conversation");
      }
    },
    [tasks, t],
  );

  return {
    goBack: useCallback(() => go(-1), [go]),
    goForward: useCallback(() => go(1), [go]),
  };
}
