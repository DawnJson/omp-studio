// 目标模式的操作：创建 / 暂停 / 继续 / 放弃（IPC taskGoal → RPC goal）和"让目标自动继续"。
// 状态不在这里缓存：结果经 TaskState.goal 回到界面（主进程以 get_state / goal_updated 为准）。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskGoal, TaskId } from "../../../../shared/ipc.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { withRpcContinuation, type GoalButton } from "./goal-model.ts";

/** omp 的设置文件监听在几百毫秒内重新加载（实测 300 ms 已生效）；写完设置后等一下再让目标继续。 */
const SETTINGS_RELOAD_MS = 500;
const CONTINUATION_KEY = "goal.continuationModes";
/** 这条 toast 带着操作按钮，比默认的 5 秒留得久一点。 */
const WARNING_MS = 15_000;

/**
 * omp 默认只在终端界面里让目标自动继续（`goal.continuationModes` = ["interactive"]）；rpc-ui 下不含 "rpc" 时，
 * 目标创建或恢复之后 omp 不会自己往下推进。不替用户改 omp 设置：只弹 warning，按钮「允许并继续」点了才写。
 * 读不到设置（omp 版本没有这项等）时什么也不弹。
 */
async function warnIfNoContinuation(taskId: TaskId, t: TFunction): Promise<void> {
  let snapshot;
  try {
    snapshot = await window.studio.getOmpConfig();
  } catch {
    return;
  }
  const next = withRpcContinuation(snapshot.items.find((item) => item.key === CONTINUATION_KEY)?.value);
  if (next === null) return;
  pushToast({
    level: "warning",
    message: t("goal.continuationOff"),
    durationMs: WARNING_MS,
    action: { label: t("goal.allowAndContinue"), run: () => void allowAndContinue(taskId, next, t) },
  });
}

/**
 * 把 "rpc" 加进 omp 的设置（保留原有值），再让当前目标跑起来。实测：对 active 的目标 `resume` 什么也不做
 * （应答 active，不起轮次），所以 active 的先 `pause` 再 `resume`；paused 的直接 `resume`。
 */
async function allowAndContinue(taskId: TaskId, modes: readonly string[], t: TFunction): Promise<void> {
  try {
    await window.studio.setOmpConfig(CONTINUATION_KEY, JSON.stringify(modes));
  } catch (error) {
    reportError(t, error, t("goal.continuationFailed"));
    return;
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, SETTINGS_RELOAD_MS);
  await promise;
  try {
    const goal = await window.studio.taskGoal(taskId, "get");
    if (goal?.status === "active") await window.studio.taskGoal(taskId, "pause");
    if (goal?.status === "active" || goal?.status === "paused") await window.studio.taskGoal(taskId, "resume");
  } catch (error) {
    reportError(t, error, t("goal.resumeFailed"));
  }
}

/** `/goal <目标>`：失败时抛出（斜杠命令的约定：草稿放回输入框，错误由调用方报告）。 */
export async function createGoal(taskId: TaskId, objective: string, t: TFunction): Promise<void> {
  await window.studio.taskGoal(taskId, "create", objective);
  await warnIfNoContinuation(taskId, t);
}

/** 暂停 / 继续 / 放弃；失败时抛出。继续之后同样检查自动继续是不是开着。 */
export async function applyGoalOp(taskId: TaskId, op: GoalButton, t: TFunction): Promise<void> {
  await window.studio.taskGoal(taskId, op);
  if (op === "resume") await warnIfNoContinuation(taskId, t);
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
