// 重开会话（顶栏标题旁的按钮、命令面板、Ctrl Shift R）：主进程结束任务的 omp 进程再 `--resume`（TaskPool.restartTask），
// 等于终端里退出会话再进，skill、MCP、插件和配置全部重新读。任务忙时不重开（主进程同样拒绝），说明原因。
import type { MessageKey, TFunction } from "../../../shared/i18n/index.ts";
import type { TaskState } from "../../../shared/ipc.ts";
import { pushToast } from "../features/dialogs/toast-store.ts";
import { reportError } from "../ui/errors.ts";

/** 不能重开的原因（按钮置灰时的提示）；能重开时为 null。 */
export function restartBlockedKey(task: TaskState): MessageKey | null {
  if (task.restartable) return null;
  if (task.status === "running") return "task.restartBusyRunning";
  if (task.status === "needs_you") return "task.restartBusyWaiting";
  if (task.status === "starting") return "task.restartBusyStarting";
  return "task.restartBusyBackground";
}

export async function restartSession(t: TFunction, task: TaskState): Promise<void> {
  const blocked = restartBlockedKey(task);
  if (blocked !== null) {
    pushToast({ level: "warning", message: t(blocked) });
    return;
  }
  try {
    await window.studio.restartTask(task.id);
    pushToast({ level: "info", message: t("task.restarted") });
  } catch (error) {
    reportError(t, error);
  }
}
