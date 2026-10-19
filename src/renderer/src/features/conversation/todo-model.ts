// 待办进度的纯计算（待办板用）：get_state.todoPhases → done/total、"当前在做的那一项"和每个阶段的进度。
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

/** 一个阶段的进度；同样不计已放弃的项。 */
export function summarizePhase(phase: TodoPhase): { done: number; total: number; active: boolean } {
  let done = 0;
  let total = 0;
  let active = false;
  for (const item of phase.tasks) {
    if (item.status === "abandoned") continue;
    total++;
    if (item.status === "completed") done++;
    else if (item.status === "in_progress") active = true;
  }
  return { done, total, active };
}

/** 阶段序号的罗马数字（1 → I）。阶段数很少，不处理 3999 以上。 */
export function toRoman(value: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = value;
  let out = "";
  for (const [size, glyph] of table) {
    while (rest >= size) {
      out += glyph;
      rest -= size;
    }
  }
  return out;
}
