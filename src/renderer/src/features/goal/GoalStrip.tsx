// 目标条（omp 目标模式）：对话流顶部、待办条下面的一行：目标文字、状态、用量，和暂停 / 继续 / 放弃。
// 数据是主进程的 TaskState.goal（get_state、goal_updated）；这里只显示，操作经 IPC taskGoal 发给 omp。
import { useState } from "react";
import type { TaskGoal, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { runGoalOp } from "./goal-actions.ts";
import { goalButtons, goalUsage, type GoalButton } from "./goal-model.ts";
import { Badge, Button } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "../composer/use-held.ts";
import "./goal.css";

const STATUS_TONE = { active: "accent", paused: "warning", "budget-limited": "error" } as const;

export function GoalStrip({ taskId, goal: liveGoal }: { taskId: TaskId; goal: TaskGoal | null }) {
  const t = useT();
  const [pending, setPending] = useState<GoalButton | null>(null);
  // 目标清掉后收起动画期间沿用上一份内容。
  const goal = useHeld(liveGoal);

  const act = (op: GoalButton) => {
    if (pending !== null) return;
    setPending(op);
    void runGoalOp(taskId, op, t).finally(() => setPending(null));
  };

  return (
    <Reveal open={liveGoal !== null} className="goal-reveal">
      {goal && (
        <div
          className="goal-strip"
          data-testid="goal-strip"
          data-status={goal.status}
          role="group"
          aria-label={t("goal.title")}
        >
          <span className="goal-objective" title={goal.objective}>
            {goal.objective}
          </span>
          {goal.status !== "active" && (
            <Badge tone={STATUS_TONE[goal.status]} testId="goal-status">
              {t(`goal.status.${goal.status}`)}
            </Badge>
          )}
          {(goal.tokensUsed > 0 || goal.tokenBudget !== null) && (
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
            <Button
              key={op}
              size="sm"
              variant={op === "drop" ? "quiet" : "secondary"}
              testId={`goal-${op}`}
              disabled={pending === op}
              onClick={() => act(op)}
            >
              {t(`goal.${op}`)}
            </Button>
          ))}
        </div>
      )}
    </Reveal>
  );
}
