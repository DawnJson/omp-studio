// 新任务页的"最近会话"：最近活动的 4 个任务（和侧栏同一份任务表、同一套排序和相对时间），两列小卡片，点了打开任务。
// 历史会话（还没挂在任务上的）不放这里；一个任务都没有时整段不显示。
import { useMemo } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { buildTimeline, projectLabels, taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { formatTaskTime, lastActivityAt } from "../../../../shared/ui/task-time.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { selectTask, useAppInfo, useTasksState } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { useHiddenTasks } from "../sidebar/archive-store.ts";
import { useProjectsState } from "../sidebar/projects-store.ts";
import { useCoarseClock } from "../sidebar/task-time.ts";
import { isDefaultFolder } from "./default-folder.ts";

const RECENT_COUNT = 4;

function RecentItem({ task, project, t, locale }: { task: TaskState; project: string; t: TFunction; locale: Locale }) {
  const cleanTitle = taskTitle(task);
  const title = cleanTitle === "" ? t("task.untitled") : cleanTitle;
  const time = useCoarseClock((now) => formatTaskTime(t, locale, lastActivityAt(task), now));
  const meta = project === "" ? time : `${project} · ${time}`;
  return (
    <li>
      <button
        type="button"
        className="er-item"
        data-testid="empty-recent-item"
        onClick={(event) =>
          void selectTask(task.id)
            .then(() => {
              // 和侧栏一样：键盘打开的才把焦点放进输入框。
              if (event.detail === 0) document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
            })
            .catch((error: unknown) => reportError(t, error))
        }
      >
        <span className="er-title" title={title}>
          {title}
        </span>
        <span className="er-meta" title={meta}>
          {meta}
        </span>
      </button>
    </li>
  );
}

export function RecentTasks() {
  const t = useT();
  const locale = useLocale();
  const tasks = useTasksState().list;
  const projects = useProjectsState().list;
  const hidden = useHiddenTasks();
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  const recent = useMemo(
    () =>
      buildTimeline({ projects, tasks, sessions: [], hidden, query: "" })
        .flatMap((item) => (item.kind === "task" ? [item.task] : []))
        .slice(0, RECENT_COUNT),
    [projects, tasks, hidden],
  );
  // 项目名和侧栏一致：重名带上级目录，默认文件夹叫"默认文件夹"。
  const labels = useMemo(() => projectLabels(projects), [projects]);
  const labelOf = (projectId: ProjectId): string => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (project === undefined) return "";
    return isDefaultFolder(project.path, chatsDir) ? t("empty.defaultFolder") : (labels.get(projectId) ?? "");
  };

  if (recent.length === 0) return null;
  return (
    <section data-testid="empty-recent" aria-labelledby="empty-recent-title">
      <h2 className="empty-section-title" id="empty-recent-title">
        {t("empty.recentTitle")}
      </h2>
      <ul className="er-grid">
        {recent.map((task) => (
          <RecentItem key={task.id} task={task} project={labelOf(task.projectId)} t={t} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
