// 订阅主进程的一次性提示（目标完成 → 本地化的 toast）。
// 另外：别的任务进入"等你确认"时弹一条 toast（spec 5.7 ④）。
import { useEffect, useRef } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { useT } from "../../i18n/use-t.ts";
import { selectTask, useSelectedTaskId, useTasks } from "../../store/index.ts";
import { pushToast } from "./toast-store.ts";

export function useTaskNotices(): void {
  const t = useT();
  useEffect(() => window.studio.onTaskNotice(() => pushToast({ level: "info", message: t("goal.completed") })), [t]);
}

export function useNeedsYouToasts(): void {
  const t = useT();
  const tasks = useTasks();
  const selected = useSelectedTaskId();
  const previous = useRef<Map<string, TaskState["status"]>>(new Map());
  useEffect(() => {
    const before = previous.current;
    for (const task of tasks) {
      if (
        task.status === "needs_you" &&
        before.get(task.id) !== "needs_you" &&
        task.id !== selected &&
        before.has(task.id)
      ) {
        pushToast({
          level: "warning",
          message: t("toast.needsYou", { task: taskTitle(task) || t("task.untitled") }),
          durationMs: 8000,
          action: { label: t("toast.view"), run: () => void selectTask(task.id) },
        });
      }
    }
    previous.current = new Map(tasks.map((task) => [task.id, task.status]));
  }, [tasks, selected, t]);
}
