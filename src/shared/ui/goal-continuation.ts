// 「目标自动推进」不是 omp-studio 自己的设置，是 omp 的 `goal.continuationModes` 的一个视图：列表里有 "rpc" 就是开。
// 这个设置只有 interactive、rpc 两个取值（omp 的描述）；开关只增减 "rpc"，其余条目原样保留。纯函数，主进程和界面共用。

export const goalContinuationKey = "goal.continuationModes";

function entries(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** 开关的状态：列表里有 "rpc"。 */
export function goalContinuationOn(value: unknown): boolean {
  return entries(value).includes("rpc");
}

/** 切换开关后要写回 omp 的新值：只加上或去掉 "rpc"，别的条目和顺序不动。 */
export function withGoalContinuation(value: unknown, on: boolean): string[] {
  const current = entries(value);
  if (on) return current.includes("rpc") ? current : [...current, "rpc"];
  return current.filter((item) => item !== "rpc");
}

/**
 * 启动时的“默认允许”：用户没有明确设置过（`explicit` 为 false）、而且列表里还没有 "rpc"，就写成原值加上 "rpc"
 * （默认值 ["interactive"] → ["interactive", "rpc"]）；其余情况返回 null，什么也不写。
 */
export function goalDefaultWrite(value: unknown, explicit: boolean): string[] | null {
  if (explicit || goalContinuationOn(value)) return null;
  return withGoalContinuation(value, true);
}
