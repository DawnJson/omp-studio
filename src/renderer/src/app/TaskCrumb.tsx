// 顶栏中间：`项目 / 任务标题` + 运行状态（状态点 + "运行中 · 1分12秒"）。设置页只显示页面标题。
import type { TaskState } from "../../../shared/ipc.ts";
import { formatDuration } from "../features/conversation/format.ts";
import { useNow } from "../features/conversation/use-now.ts";
import { useDraftProject } from "../features/empty/index.ts";
import { useProjects } from "../features/sidebar/index.ts";
import { useT } from "../i18n/use-t.ts";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";

function TaskStatus({ task }: { task: TaskState }) {
  const t = useT();
  const running = task.status === "running" && task.runStartedAt !== null;
  const now = useNow(running);
  if (task.status === "running" || task.status === "starting") {
    const label =
      running && task.runStartedAt !== null
        ? t("window.runningFor", { time: formatDuration(t, now - task.runStartedAt) })
        : t("status.running");
    return (
      <span className="crumb-status" data-kind="running" data-testid="topbar-status" role="status">
        <i aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (task.status === "needs_you")
    return (
      <span className="crumb-status" data-kind="waiting" data-testid="topbar-status" role="status">
        <i aria-hidden="true" />
        {t("status.waiting")}
      </span>
    );
  if (task.status === "error")
    return (
      <span className="crumb-status" data-kind="error" data-testid="topbar-status" role="status">
        <i aria-hidden="true" />
        {t("status.error")}
      </span>
    );
  return null;
}

export function TaskCrumb() {
  const t = useT();
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const projects = useProjects();
  const draftProject = useDraftProject();

  if (view === "settings")
    return (
      <div className="crumb" data-testid="topbar-crumb">
        <b>{t("menu.settings")}</b>
      </div>
    );

  if (taskId === null || task === null)
    return (
      <div className="crumb" data-testid="topbar-crumb">
        {draftProject !== null && (
          <>
            <span className="crumb-project">{draftProject.name}</span>
            <span className="crumb-sep">/</span>
          </>
        )}
        <b>{t("menu.newTask")}</b>
      </div>
    );

  const project = projects.find((candidate) => candidate.id === task.projectId);
  const title = task.title.trim() === "" ? t("task.untitled") : task.title;
  return (
    <div className="crumb" data-testid="topbar-crumb">
      {project !== undefined && (
        <>
          <span className="crumb-project">{project.name}</span>
          <span className="crumb-sep">/</span>
        </>
      )}
      <b className="crumb-title">{title}</b>
      <TaskStatus task={task} />
    </div>
  );
}
