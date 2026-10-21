// 目标模式的操作：创建 / 暂停 / 继续 / 放弃（IPC taskGoal → omp 的 /goal 命令）。
// 状态不在这里缓存：结果经 TaskState.goal 回到界面（主进程读输入框卡片上的目标行为准）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskGoal, TaskId } from "../../../../shared/ipc.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import type { GoalButton } from "./goal-model.ts";

/** `/goal <目标>`：失败时抛出（斜杠命令的约定：草稿放回输入框，错误由调用方报告）。 */
export async function createGoal(taskId: TaskId, objective: string): Promise<void> {
  await window.studio.taskGoal(taskId, "create", objective);
}

/** 暂停 / 继续 / 放弃；失败时抛出。 */
export async function applyGoalOp(taskId: TaskId, op: GoalButton): Promise<void> {
  await window.studio.taskGoal(taskId, op);
}

/** 按钮和命令面板用：失败弹 toast（omp 的原话在悬停提示里）。 */
export async function runGoalOp(taskId: TaskId, op: GoalButton, t: TFunction): Promise<void> {
  try {
    await applyGoalOp(taskId, op);
  } catch (error) {
    reportError(t, error, t(`goal.${op}Failed`));
  }
}

/** `/goal`（没有参数）：把当前目标说出来。 */
export async function showGoal(taskId: TaskId, t: TFunction): Promise<void> {
  const goal: TaskGoal | null = await window.studio.taskGoal(taskId, "get");
  pushToast({
    message: goal
      ? t("goal.current", { status: t(`goal.status.${goal.status}`), objective: goal.objective })
      : t("goal.none"),
  });
}
