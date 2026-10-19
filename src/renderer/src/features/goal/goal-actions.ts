// 目标模式的操作：创建 / 暂停 / 继续 / 放弃（IPC taskGoal → RPC goal）。
// 状态不在这里缓存：结果经 TaskState.goal 回到界面（主进程以 get_state / goal_updated 为准）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskGoal, TaskId } from "../../../../shared/ipc.ts";
import { showView } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import type { GoalButton } from "./goal-model.ts";

/** 这条 toast 带着操作按钮，比默认的 5 秒留得久一点。 */
const INFO_MS = 10_000;

/**
 * 目标要靠 omp 的 `goal.continuationModes` 含 "rpc" 才会在 rpc-ui 下自己推进（实测）；omp-studio 用 `--config` 覆盖带上它，
 * 由设置里的“目标自动推进”控制。关着时创建或恢复目标，告诉用户目标不会自己推进，并给出去设置里打开的入口。
 * 读不到设置时什么也不弹。
 */
async function noteIfAutoContinueOff(t: TFunction): Promise<void> {
  let settings;
  try {
    settings = await window.studio.getSettings();
  } catch {
    return;
  }
  if (settings.goalAutoContinue) return;
  pushToast({
    level: "info",
    message: t("goal.autoContinueOff"),
    durationMs: INFO_MS,
    action: { label: t("goal.openSettings"), run: () => showView("settings", { section: "general" }) },
  });
}

/** `/goal <目标>`：失败时抛出（斜杠命令的约定：草稿放回输入框，错误由调用方报告）。 */
export async function createGoal(taskId: TaskId, objective: string, t: TFunction): Promise<void> {
  await window.studio.taskGoal(taskId, "create", objective);
  await noteIfAutoContinueOff(t);
}

/** 暂停 / 继续 / 放弃；失败时抛出。继续之后同样看一下自动推进是不是开着。 */
export async function applyGoalOp(taskId: TaskId, op: GoalButton, t: TFunction): Promise<void> {
  await window.studio.taskGoal(taskId, op);
  if (op === "resume") await noteIfAutoContinueOff(t);
}

/** 按钮和命令面板用：失败弹 toast（omp 的原话在悬停提示里）。 */
export async function runGoalOp(taskId: TaskId, op: GoalButton, t: TFunction): Promise<void> {
  try {
    await applyGoalOp(taskId, op, t);
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
