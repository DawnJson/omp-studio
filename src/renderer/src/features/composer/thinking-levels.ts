// 思考强度的显示文案和 Alt T 的轮换。纯函数；档位列表和钳制规则在 shared/ui/new-task-default.ts。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export const thinkingLabel: Partial<Record<ThinkingLevel, MessageKey>> = {
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
  max: "thinking.max",
};

/** Alt T：在同一份列表里循环到下一档；当前档不在列表里（或没有）从第一档开始。 */
export function nextThinkingLevel(
  levels: readonly ThinkingLevel[],
  current: ThinkingLevel | null,
): ThinkingLevel | null {
  if (levels.length === 0) return null;
  const index = current === null ? -1 : levels.indexOf(current);
  return levels[(index + 1) % levels.length] ?? null;
}

/** 方向键在分段条里移动：到头循环。 */
export function stepThinkingLevel(
  levels: readonly ThinkingLevel[],
  current: ThinkingLevel | null,
  delta: 1 | -1,
): ThinkingLevel | null {
  if (levels.length === 0) return null;
  const index = current === null ? 0 : Math.max(levels.indexOf(current), 0);
  return levels[(index + delta + levels.length) % levels.length] ?? null;
}
