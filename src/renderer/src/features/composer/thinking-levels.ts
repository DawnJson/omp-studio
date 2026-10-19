// 思考强度的档位列表、omp 的钳制规则和 Alt T 的轮换。纯函数；picker、胶囊、Alt T 共用同一份列表。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ModelOption } from "../../../../shared/ipc.ts";
import type { Effort, ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export const thinkingLabel: Partial<Record<ThinkingLevel, MessageKey>> = {
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
  max: "thinking.max",
};

/** 从弱到强。`off` 不在里面：它不是 effort，只有任务里 omp 报告了才有。 */
export const effortOrder: readonly Effort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const rank = (level: ThinkingLevel): number => effortOrder.indexOf(level as Effort);

/**
 * 选中的模型实际支持的档位，按界面顺序。
 * - 任务里：`live` 是 omp 的 get_available_thinking_levels（含 off，不含 auto、inherit），原样用。
 * - 草稿里（还没有进程，live 为空）：用模型的 thinking.efforts（不含 off：omp 的 defaultThinkingLevel 不接受 off）；
 *   omp 没给这个模型的思考配置时退回全部 effort。
 * 不支持思考的模型没有档位。
 */
export function thinkingLevelOptions(model: ModelOption | null, live: readonly ThinkingLevel[]): ThinkingLevel[] {
  if (model === null || !model.reasoning) return [];
  if (live.length > 0) return live.filter((level) => level === "off" || rank(level) >= 0);
  const efforts = model.thinkingEfforts ?? effortOrder;
  return effortOrder.filter((level) => efforts.includes(level));
}

/**
 * omp 把设置的档位钳到模型支持的档位：取最近的，一样近取较低的。
 * 实测 deepseek-v4-flash（efforts low/high/max）：minimal→low，medium→low，xhigh→high（真实 omp 18.12.2）。
 * 草稿没有进程可读回，用同一规则算出 omp 会实际采用的档位。
 */
export function clampThinkingLevel(level: ThinkingLevel, supported: readonly ThinkingLevel[]): ThinkingLevel | null {
  if (supported.includes(level)) return level;
  const from = rank(level);
  if (from < 0) return null;
  let best: ThinkingLevel | null = null;
  let bestDistance = Infinity;
  for (const candidate of supported) {
    const at = rank(candidate);
    if (at < 0) continue;
    const distance = Math.abs(at - from);
    if (distance < bestDistance || (distance === bestDistance && at < rank(best as ThinkingLevel))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

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
