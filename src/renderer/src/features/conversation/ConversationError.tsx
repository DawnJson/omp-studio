// 任务出错（进程退出、协议错误、启动失败）：对话流末尾一条内联条 + 一个恢复动作（spec 4.24）。
import { describeError, reportError } from "../../ui/errors.ts";
import type { TaskError, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { pushToast } from "../dialogs/index.ts";

export function ConversationError({ taskId, error }: { taskId: TaskId; error: TaskError }) {
  const t = useT();
  const exitCode = /exit(?:ed)?(?: with)?(?: code)?\s*[:=]?\s*(-?\d+)/i.exec(error.message)?.[1];
  const text =
    error.kind === "exited"
      ? exitCode !== undefined
        ? t("error.exited", { code: exitCode })
        : t("error.exitedNoCode")
      : error.kind === "protocol"
        ? t("error.protocol")
        : error.kind === "too_many_tasks"
          ? t("error.tooManyTasks")
          : error.kind === "restore_model_failed"
            ? t("error.modelUnavailable")
            : describeError(t, error);
  const reconnect = () => {
    window.studio.restartTask(taskId).catch((cause: unknown) => reportError(t, cause));
  };
  const copy = () => {
    void navigator.clipboard.writeText(`${error.kind}: ${error.message}`).then(
      () => pushToast({ message: t("common.copied") }),
      (cause: unknown) => reportError(t, cause),
    );
  };
  return (
    <div className="inline-error" role="alert" data-testid="task-error">
      <span className="inline-error-text">{text}</span>
      <button type="button" className="inline-error-action" onClick={reconnect}>
        {t("error.reconnect")}
      </button>
      <button type="button" className="inline-error-action" onClick={copy}>
        {t("error.copyDetails")}
      </button>
    </div>
  );
}
