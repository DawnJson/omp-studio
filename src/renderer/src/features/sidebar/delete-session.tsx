// 删除会话（不可撤销，spec §4.2）：任务菜单（侧栏行 / 顶栏 ⋯）和会话行的菜单都只往这里放一条请求，DeleteSessionHost（挂在 App 里）
// 弹 danger 确认框；确认后由主进程经 omp 自己的 `/delete` 删掉会话文件（TaskPool.deleteTask / deleteSession）。
// 成功时任务行随 taskRemoved 消失、会话列表重取；失败 toast 带 omp 的原话，任务和会话都不动。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { describeError, errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { pushToast } from "../dialogs/index.ts";
import { refreshHistorySessions } from "./use-history-sessions.ts";

/** 要删的：任务（有任务记录的，含没在跑的）或会话行（已归档的、终端里开的）。`title` 是界面上显示的标题，空串 = 未命名。 */
export type DeleteTarget =
  { kind: "task"; taskId: TaskId; title: string } | { kind: "session"; sessionId: string; title: string };

let serial = 0;
const request = createStore<{ key: number; target: DeleteTarget } | null>(null);

/** 弹出删除确认框。 */
export function confirmDelete(target: DeleteTarget): void {
  serial += 1;
  request.set({ key: serial, target });
}

async function runDelete(t: TFunction, target: DeleteTarget): Promise<void> {
  try {
    if (target.kind === "task") await window.studio.deleteTask(target.taskId);
    else await window.studio.deleteSession(target.sessionId);
  } catch (error) {
    // omp 拒绝（vibe 模式里的 `Exit vibe mode first.` 等）的原话就是原因，直接放进正文；已知的错误用翻译好的那句。
    const known = describeError(t, error);
    const reason = known === t("error.generic") ? errorDetail(error) : known;
    pushToast({ level: "error", message: t("task.deleteFailed", { message: reason }), title: errorDetail(error) });
  }
  refreshHistorySessions();
}

export function DeleteSessionHost() {
  const t = useT();
  const current = useStoreValue(request, (state) => state);
  if (current === null) return null;
  const { target } = current;
  const close = () => {
    if (request.get()?.key === current.key) request.set(null);
  };
  return (
    <ConfirmDialog
      key={current.key}
      danger
      testId="delete-session-dialog"
      title={t("task.deleteTitle")}
      body={t("task.deleteBody", { title: target.title === "" ? t("task.untitled") : target.title })}
      confirmLabel={t("task.deleteConfirm")}
      onCancel={close}
      onConfirm={() => {
        close();
        void runDelete(t, target);
      }}
    />
  );
}
