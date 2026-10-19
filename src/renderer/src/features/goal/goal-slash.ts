// `/goal [目标]`：带文字创建目标（omp 之后自己连续推进）；不带文字说出当前目标；单独的 pause / resume / drop 操作当前目标。
// 不发给模型。omp 的 TUI 有同名命令，但 rpc-ui 的命令列表里没有（trial-tui 实测）。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { applyGoalOp, createGoal, showGoal } from "./goal-actions.ts";
import { parseGoalArgs } from "./goal-model.ts";

export const goalSlash: StudioSlashCommand = {
  name: "goal",
  descKey: "goal.slashDesc",
  async run(taskId, args, t) {
    const parsed = parseGoalArgs(args);
    if (parsed.kind === "show") await showGoal(taskId, t);
    else if (parsed.kind === "op") await applyGoalOp(taskId, parsed.op, t);
    else await createGoal(taskId, parsed.objective, t);
  },
};
