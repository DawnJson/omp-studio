// 顶栏中间：任务标题。空状态显示"新任务"，设置页显示页面标题。任务状态只在侧栏和输入框上方的状态行里，这里不重复。
import { useT } from "../i18n/use-t.ts";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";

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
    </div>
  );
}
