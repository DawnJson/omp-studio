// 顶栏中间：任务标题。空状态显示"新任务"，设置页显示页面标题。任务状态只在侧栏和输入框上方的状态行里，这里不重复。
// 任务标题右边一个"重开会话"按钮（restart-session.ts）：任务忙时置灰，悬停写明原因。
import { useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { withShortcut } from "./platform-keys.ts";
import { Restart } from "../icons.tsx";
import { useMainView, useSelectedTaskId, useTask } from "../store/index.ts";
import { IconButton } from "../ui/controls.tsx";
import { taskTitle } from "../../../shared/ui/sidebar-model.ts";
import { restartBlockedKey, restartSession } from "./restart-session.ts";

export function TaskCrumb() {
  const t = useT();
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const task = useTask(taskId);
  const [restarting, setRestarting] = useState(false);

  if (view === "settings")
    return (
      <div className="crumb" data-testid="topbar-crumb">
        <span className="crumb-title">{t("menu.settings")}</span>
      </div>
    );

  if (taskId === null || task === null)
    return (
      <div className="crumb" data-testid="topbar-crumb">
        <span className="crumb-title">{t("menu.newTask")}</span>
      </div>
    );

  const title = taskTitle(task) || t("task.untitled");
  const blocked = restartBlockedKey(task);
  const restart = () => {
    setRestarting(true);
    void restartSession(t, task).finally(() => setRestarting(false));
  };
  return (
    <div className="crumb" data-testid="topbar-crumb">
      <span className="crumb-title" title={title}>
        {title}
      </span>
      <IconButton
        className="crumb-restart"
        label={t("task.restart")}
        tip={blocked === null ? withShortcut(t("task.restartTip"), "Ctrl Shift R") : t(blocked)}
        disabled={blocked !== null || restarting}
        testId="topbar-restart"
        onClick={restart}
      >
        <Restart size={14} />
      </IconButton>
    </div>
  );
}
