// 空状态里该项目最近的 3 个任务：可点的入口，不是列表。只显示 Studio 里的任务（含归档以外的全部），历史会话在侧栏搜索。
import { useMemo } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { selectTask, useTasks } from "../../store/index.ts";
import { useHiddenTasks } from "../sidebar/archive-store.ts";
import { StatusDot } from "../sidebar/StatusDot.tsx";
import { formatTaskTime, lastActivityAt } from "../../../../shared/ui/task-time.ts";
import { byRecent } from "../../../../shared/ui/sidebar-model.ts";
import { useNow } from "../sidebar/task-time.ts";

export const recentLimit = 3;

export function RecentTasks({ projectId }: { projectId: ProjectId }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const tasks = useTasks();
  const hidden = useHiddenTasks();
  const recent = useMemo(
    () =>
      tasks
        .filter((task) => task.projectId === projectId && !hidden.has(task.id))
        .sort(byRecent)
        .slice(0, recentLimit),
    [tasks, hidden, projectId],
  );
  if (recent.length === 0) return null;
  return (
    <section>
      <h2 className="empty-recent-h">{t("empty.recent")}</h2>
      <ul className="empty-recent" aria-label={t("empty.recent")} data-testid="empty-recent">
        {recent.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className="empty-task"
              data-testid="empty-task"
              onClick={() => void selectTask(task.id).catch((error: unknown) => reportError(t, error))}
            >
              <span className="empty-task-top">
                <StatusDot task={task} t={t} />
                <span className="empty-task-title">{task.title.trim() === "" ? t("task.untitled") : task.title}</span>
              </span>
              <span className="empty-task-time">{formatTaskTime(t, locale, lastActivityAt(task), now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
