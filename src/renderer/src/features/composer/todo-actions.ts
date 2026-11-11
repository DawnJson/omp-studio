// 待办板上的动作：`/todo` 的子命令一律经 runTaskCommand（封闭联合 TaskCommand，主进程拼 `/todo …` 发给任务的 omp）；
// omp 的反馈（成功是状态 toast，没匹配到是 `Error: …` 行）原文回读：成功的 toast 照显，失败走 reportOmpError。
// "复制为 Markdown"不经 omp，在待办板里本地拼（TodoBoard.tsx）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { TaskCommand } from "../../../../shared/omp-output/index.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";

export type TodoCommand = Extract<TaskCommand, { kind: "todo" }>;

/** 执行一条 `/todo` 命令；成功返回 true（omp 的状态 toast 原文作为提示显示），失败报错返回 false。 */
export async function runTodo(t: TFunction, taskId: TaskId, command: TodoCommand): Promise<boolean> {
  try {
    const { text } = await window.studio.runTaskCommand(taskId, command);
    if (text !== "") pushToast({ message: text });
    return true;
  } catch (error) {
    reportOmpError(t, error);
    return false;
  }
}
