// 会话信息相关的动作：置顶切换、重试、复制、在浏览器打开请求记录。命令都走 runTaskCommand（封闭联合类型，渲染进程不发自由文本）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportError, reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";

/**
 * `/pin` 是切换。切换前后各读一次 `session-pins.json`（主进程只读，写入是 omp 的事）：状态变了就按新状态提示；
 * 没变（任务没有会话文件、omp 拒绝…）就把 omp 的原话当警告显示，不假装成功。
 */
export async function togglePin(t: TFunction, taskId: TaskId): Promise<void> {
  try {
    const before = (await window.studio.getTaskSessionInfo(taskId)).pinned;
    const { text } = await window.studio.runTaskCommand(taskId, { kind: "pin" });
    const after = (await window.studio.getTaskSessionInfo(taskId)).pinned;
    if (after === before) {
      pushToast({ level: "warning", message: text === "" ? t("sessionInfo.pinUnchanged") : text });
    } else {
      pushToast({ message: t(after ? "sessionInfo.pinnedToast" : "sessionInfo.unpinnedToast") });
    }
  } catch (error) {
    reportOmpError(t, error);
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

/**
 * 请求记录页的"在浏览器中打开"：在任务的 omp 里执行 `/trace`（omp 18.12.6 实测）。omp 在任务进程里起统计面板服务
 * （默认 127.0.0.1:3847，已有就复用），自己用系统浏览器打开这个会话的请求记录，状态 toast 是 `Trace: <URL>`；
 * studio 不再自己开一遍（会出两个标签页），toast 里的 URL 放在提示的悬停文字里，万一浏览器没起来可以看到。
 * omp 拒绝（没有会话文件等）时 toast 不是 `Trace: ` 开头，原文当错误显示。
 */
export async function openTraceInBrowser(t: TFunction, taskId: TaskId): Promise<void> {
  try {
    const { text } = await window.studio.runTaskCommand(taskId, { kind: "trace" });
    if (text.startsWith("Trace: "))
      pushToast({ message: t("sessionInfo.trace.opened"), title: text.slice("Trace: ".length) });
    else pushToast({ level: "warning", message: text });
  } catch (error) {
    reportOmpError(t, error);
  }
}
