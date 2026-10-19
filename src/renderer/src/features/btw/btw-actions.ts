// 旁路提问的动作：提问、取消。出错抛给调用方（斜杠命令由 sendDraft 放回草稿并提示；面板自己 reportError）。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { pushToast } from "../dialogs/index.ts";
import { selectBtwTopic } from "./btw-ui-store.ts";

/** 发一条旁路提问；recordId 为 undefined 时开新话题。成功后面板切到这个话题。 */
export async function askBtwQuestion(taskId: TaskId, question: string, recordId: string | undefined): Promise<void> {
  const id = await window.studio.askBtw(taskId, question, recordId);
  selectBtwTopic(taskId, id);
}

/** 取消在跑的旁路提问（Esc、取消按钮）。 */
export async function cancelBtwQuestion(taskId: TaskId, t: TFunction): Promise<void> {
  try {
    if (!(await window.studio.cancelBtw(taskId))) pushToast({ level: "info", message: t("btw.cancelNothing") });
  } catch (error) {
    reportError(t, error, t("btw.cancelFailed"));
  }
}
