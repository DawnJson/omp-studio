// 订阅主进程的一次性提示：toast 进 toast 队列；set_editor_text 交给输入框（已有草稿时输入框弹"替换/保留"）。
// 另外：别的任务进入"等你确认"时弹一条 toast（spec 5.7 ④）。
import { useEffect, useRef } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { suggestEditorText } from "../composer/draft-store.ts";
import { selectTask, useSelectedTaskId, useTasks } from "../../store/index.ts";
import { pushToast } from "./toast-store.ts";

export function useTaskNotices(): void {
  const t = useT();
  useEffect(
    () =>
      window.studio.onTaskNotice((notice) => {
        if (notice.kind === "toast") pushToast({ level: notice.level, message: notice.message });
        else if (notice.kind === "goal_complete") pushToast({ level: "info", message: t("goal.completed") });
        else suggestEditorText(notice.taskId, notice.text);
      }),
    [t],
  );
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
          message: t("toast.needsYou", { task: task.title }),
          durationMs: 8000,
          action: { label: t("toast.view"), run: () => void selectTask(task.id) },
        });
      }
    }
    previous.current = new Map(tasks.map((task) => [task.id, task.status]));
  }, [tasks, selected, t]);
}
