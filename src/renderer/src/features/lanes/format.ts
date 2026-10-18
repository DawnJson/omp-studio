import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";

export function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

/** 1234567 → 1.2M；小于一万原样加千分位。 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${(count / 1000).toFixed(1)}k`;
  return count.toLocaleString("en-US");
}

/** `deepseek/deepseek-v4-flash` → `deepseek-v4-flash`（完整名放悬停提示）。 */
export function shortModel(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1);
}

export function modelLine(lane: SubagentLane): string | null {
  if (lane.model === null) return null;
  return lane.thinkingLevel ? `${shortModel(lane.model)} · ${lane.thinkingLevel}` : shortModel(lane.model);
}

export function statusLabel(t: TFunction, status: SubagentLane["status"]): string {
  return t(`lanes.status.${status}`);
}
