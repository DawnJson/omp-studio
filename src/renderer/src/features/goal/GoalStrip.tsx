// 目标条（omp 目标模式）：对话流顶部、待办条下面的一行：目标文字、状态、用量，和暂停 / 继续 / 放弃。
// 数据是主进程的 TaskState.goal（get_state、goal_updated）；这里只显示，操作经 IPC taskGoal 发给 omp。
import { useState } from "react";
import type { TaskGoal, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { runGoalOp } from "./goal-actions.ts";
import { goalButtons, goalUsage, type GoalButton } from "./goal-model.ts";
import "./goal.css";

export function GoalStrip({ taskId, goal }: { taskId: TaskId; goal: TaskGoal | null }) {
  const t = useT();
  const [pending, setPending] = useState<GoalButton | null>(null);
  if (!goal) return null;

  const act = (op: GoalButton) => {
    setPending(op);
    void runGoalOp(taskId, op, t).finally(() => setPending(null));
  };
  const showUsage = goal.tokensUsed > 0 || goal.tokenBudget !== null;

  return (
    <div
      className="goal-strip"
      data-testid="goal-strip"
      data-status={goal.status}
      role="group"
      aria-label={t("goal.title")}
    >
      <span className="goal-label">{t("goal.title")}</span>
      <span className="goal-objective" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="goal-status" data-testid="goal-status">
        {t(`goal.status.${goal.status}`)}
      </span>
      {showUsage && (
        <span
          className="goal-usage"
          title={t(goal.tokenBudget === null ? "goal.usageTitle" : "goal.usageBudgetTitle", {
            used: goal.tokensUsed,
            budget: goal.tokenBudget ?? 0,
          })}
        >
          {goalUsage(goal)}
        </span>
      )}
      {goalButtons(goal).map((op) => (
        <button
          key={op}
          type="button"
          className="goal-action"
          data-testid={`goal-${op}`}
          disabled={pending !== null}
          onClick={() => act(op)}
        >
          {t(`goal.${op}`)}
        </button>
      ))}
    </div>
  );
}
