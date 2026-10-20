// 顶栏中间：任务标题 + 状态胶囊（运行中 / 等你确认 / 出错）。空状态显示"新任务"，设置页显示页面标题。
import type { TaskState } from "../../../shared/ipc.ts";
import { useT } from "../i18n/use-t.ts";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";

function TaskStatus({ task }: { task: TaskState }) {
  const t = useT();
  if (task.status === "running" || task.status === "starting") {
    return (
      <span className="crumb-status" data-kind="running" data-testid="topbar-status" role="status">
        <i aria-hidden="true" />
        {t("status.running")}
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

  if (view === "settings")
    return (
      <div className="crumb" data-testid="topbar-crumb">
        <b className="crumb-title">{t("menu.settings")}</b>
      </div>
    );

  if (taskId === null || task === null)
    return (
      <div className="crumb" data-testid="topbar-crumb">
        <b className="crumb-title">{t("menu.newTask")}</b>
      </div>
    );

  const title = task.title.trim() === "" ? t("task.untitled") : task.title;
  return (
    <div className="crumb" data-testid="topbar-crumb">
      <b className="crumb-title" title={title}>
        {title}
      </b>
      <TaskStatus task={task} />
    </div>
  );
}
