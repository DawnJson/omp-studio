// 目标模式（omp goal）的纯函数：`/goal` 参数解析、目标条上能点哪些按钮、用量文字、自动继续设置的改写。
// 语义出自实测（见 docs/architecture/conversation.md 的"目标模式"一节）。
import type { TaskGoal } from "../../../../shared/ipc.ts";

export type GoalButton = "pause" | "resume" | "drop";

/** `/goal` 后面的文字：空 = 显示当前目标；单独一个 pause / resume / drop 是操作；其余整段是新目标。 */
type GoalArgs = { kind: "show" } | { kind: "op"; op: GoalButton } | { kind: "create"; objective: string };

export function parseGoalArgs(args: string): GoalArgs {
  const text = args.trim();
  if (text === "") return { kind: "show" };
  const lower = text.toLowerCase();
  if (lower === "pause" || lower === "resume" || lower === "drop") return { kind: "op", op: lower };
  return { kind: "create", objective: text };
}

/**
 * 目标条和命令面板上现在能做的操作。omp 的 `resume` 只恢复 paused 的目标（rpc.md），budget-limited 的只能放弃；
 * pause 只对进行中的有意义；任何还挂着的目标都能放弃。
 */
export function goalButtons(goal: TaskGoal | null): GoalButton[] {
  if (!goal) return [];
  if (goal.status === "active") return ["pause", "drop"];
  if (goal.status === "paused") return ["resume", "drop"];
  return ["drop"];
}

/** 1234 → "1.2k"，12_345 → "12k"，1_500_000 → "1.5M"。 */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** 目标条上的用量：有预算时 "已用 / 预算"，没有时只有已用。 */
export function goalUsage(goal: Pick<TaskGoal, "tokensUsed" | "tokenBudget">): string {
  return goal.tokenBudget === null
    ? formatTokens(goal.tokensUsed)
    : `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`;
}
