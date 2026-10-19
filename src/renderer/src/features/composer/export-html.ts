// 导出对话为 HTML：保存对话框和写文件都在主进程（渲染进程不传路径）；取消什么也不做，成功后 toast 带"在文件夹中显示"。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";

/** 失败时抛出（斜杠命令由 sendDraft 报错并把草稿放回）。 */
export async function exportConversation(taskId: TaskId, t: TFunction): Promise<void> {
  const result = await window.studio.exportTaskHtml(taskId);
  if (result === null) return;
  pushToast({
    level: "info",
    message: t("toast.exported", { name: result.fileName }),
    durationMs: 8000,
    action: {
      label: t("toast.revealExport"),
      run: () => void window.studio.revealTaskExport(taskId).catch((error: unknown) => reportError(t, error)),
    },
  });
}

/** 菜单、命令面板用：自己报错。 */
export async function exportConversationReporting(taskId: TaskId, t: TFunction): Promise<void> {
  try {
    await exportConversation(taskId, t);
  } catch (error) {
    reportError(t, error);
  }
}
