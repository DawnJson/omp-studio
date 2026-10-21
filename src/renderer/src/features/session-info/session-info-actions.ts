// 会话信息相关的动作：置顶切换、重试、复制。命令都走 runTaskCommand（封闭联合类型，渲染进程不发自由文本）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportError, reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";

/**
 * `/pin` 是切换。切换前后各读一次 `session-pins.json`（主进程只读，写入是 omp 的事）：状态变了就按新状态提示；
 * 没变（任务没有会话文件、omp 拒绝…）就把 omp 的原话当警告显示，不假装成功。返回切换后的状态；失败返回 null。
 */
export async function togglePin(t: TFunction, taskId: TaskId): Promise<boolean | null> {
  try {
    const before = (await window.studio.getTaskSessionInfo(taskId, false)).pinned;
    const { text } = await window.studio.runTaskCommand(taskId, { kind: "pin" });
    const after = (await window.studio.getTaskSessionInfo(taskId, false)).pinned;
    if (after === before) {
      pushToast({ level: "warning", message: text === "" ? t("sessionInfo.pinUnchanged") : text });
      return after;
    }
    pushToast({ message: t(after ? "sessionInfo.pinnedToast" : "sessionInfo.unpinnedToast") });
    return after;
  } catch (error) {
    reportOmpError(t, error);
    return null;
  }
}

/**
 * `/retry`：重新发送上一轮。成功时 omp 直接重跑这一轮（对话里就能看到），不另外提示；没有可重试的内容等 omp 自己的拒绝原文
 * （"Nothing to retry"）以错误形式显示。
 */
export async function retryTask(t: TFunction, taskId: TaskId): Promise<void> {
  try {
    await window.studio.runTaskCommand(taskId, { kind: "retry" });
  } catch (error) {
    reportOmpError(t, error);
  }
}

export function copyText(t: TFunction, text: string): void {
  navigator.clipboard.writeText(text).then(
    () => pushToast({ message: t("sessionInfo.copied") }),
    (error: unknown) => reportError(t, error),
  );
}
