// 待办进度的纯计算（TodoStrip 用）：get_state.todoPhases → 胶囊里的 done/total 和"当前在做的那一项"。
import type { TodoItem, TodoPhase } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export interface TodoSummary {
  done: number;
  /** 不含已放弃的项：放弃不是"还没做完"，也不该拉低进度。 */
  total: number;
  /** 第一个进行中的项；没有时取第一个未开始的项；全做完或没有可做的项时为 null。 */
  current: TodoItem | null;
}

export function summarizeTodos(phases: readonly TodoPhase[]): TodoSummary {
  let done = 0;
  let total = 0;
  let active: TodoItem | null = null;
  let next: TodoItem | null = null;
  for (const phase of phases) {
    for (const item of phase.tasks) {
      if (item.status === "abandoned") continue;
      total++;
      if (item.status === "completed") done++;
      else if (item.status === "in_progress") active ??= item;
      else if (item.status === "pending") next ??= item;
    }
  }
  return { done, total, current: active ?? next };
}
