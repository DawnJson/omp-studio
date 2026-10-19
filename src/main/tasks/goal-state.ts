// omp 的 goal 模式 → TaskState.goal（纯函数，runner 和单元测试共用）。
// 实测（omp 18.12.2，rpc-ui）：goal 的生命周期只有 active / paused / budget-limited 三种"还在"的状态；
// complete 和 dropped 在 goal_updated 里各来一次（complete 时 state.mode 是 "exiting"），之后 get_state.goal 为 null，
// 所以这两种状态不进 TaskState：界面上目标直接消失。
import type { TaskGoal } from "../../shared/ipc.ts";
import type { Goal } from "../../shared/omp-wire/rpc-wire.generated.ts";

/** 还挂在会话上的目标 → TaskGoal；已完成、已放弃或没有目标时为 null。`goal_updated`、`goal` 应答的 `goal` 字段和 get_state.goal.goal 都是 Goal。 */
export function toTaskGoal(goal: Goal | null | undefined): TaskGoal | null {
  if (!goal || goal.status === "complete" || goal.status === "dropped") return null;
  return {
    id: goal.id,
    objective: goal.objective,
    status: goal.status,
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget ?? null,
    timeUsedSeconds: goal.timeUsedSeconds,
  };
}

/** 内容相同就不必再发一次状态（omp 每 1–2 秒推一次用量，状态不变时可以跳过）。 */
export function sameGoal(a: TaskGoal | null, b: TaskGoal | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.objective === b.objective &&
    a.status === b.status &&
    a.tokensUsed === b.tokensUsed &&
    a.tokenBudget === b.tokenBudget &&
    a.timeUsedSeconds === b.timeUsedSeconds
  );
}
