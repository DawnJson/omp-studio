// 某个模型在什么上下文用量时被 omp 压缩（模型选择对话框的"压缩于"）。规则照 omp 文档 settings.md / compaction.md：
// - compaction.modelThresholds（开着时）：精确的 `provider/model-id` 优先，否则最长的 `前缀*`。
//   数字 = 基数：当成窗口套用通常的规则（全局 thresholdTokens 不再生效）；`"f90000"` = 固定触发；`"80%"` = 百分比，替换两个全局阈值。
// - 否则 thresholdTokens > 0 固定触发；thresholdPercent > 0 按窗口百分比（夹到 1–99）；都没有就是窗口减预留。
// - 固定触发到达或超过窗口时，退回窗口减预留（omp 的 "capped by window"）。
// - 预留：max(floor(窗口 × 15%), reserveTokens ?? 16384)；它吃掉整个窗口时用 15%。
import type { CompactionSettings, ModelKey } from "./ipc.ts";

const defaultReserve = 16384;

export interface CompactionTrigger {
  tokens: number;
  /** percent：窗口（或基数）的百分比；fixed：固定 token 数；reserve：窗口（或基数）减预留。 */
  kind: "percent" | "fixed" | "reserve";
  percent: number | null;
  /** 按模型设置的基数（数字形式的 modelThresholds 条目）；没有为 null。 */
  base: number | null;
  /** reserve 时的预留 token 数。 */
  reserve: number | null;
  /** 固定触发到达窗口，被退回到窗口减预留。 */
  capped: boolean;
  source: "global" | "project" | "model";
}

function reserveTokens(window: number, configured: number | null): number {
  const proportional = Math.floor(window * 0.15);
  const reserve = Math.max(proportional, configured ?? defaultReserve);
  return reserve >= window ? proportional : reserve;
}

/** 这个模型命中的 modelThresholds 条目（精确键优先，否则最长的 `*` 前缀）。 */
export function matchModelThreshold(
  entries: Record<string, number | string>,
  key: ModelKey,
): number | string | undefined {
  const full = `${key.provider}/${key.modelId}`;
  if (Object.hasOwn(entries, full)) return entries[full];
  let best: string | null = null;
  for (const pattern of Object.keys(entries)) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (full.startsWith(prefix) && (best === null || prefix.length > best.length - 1)) best = pattern;
  }
  return best === null ? undefined : entries[best];
}

const clampPercent = (value: number) => Math.min(99, Math.max(1, value));

export function compactionTrigger(settings: CompactionSettings, key: ModelKey, window: number): CompactionTrigger {
  const none = { percent: null, base: null, reserve: null, capped: false } as const;
  const byReserve = (size: number, base: number | null, source: CompactionTrigger["source"]): CompactionTrigger => {
    const reserve = reserveTokens(size, settings.reserveTokens);
    return { ...none, tokens: size - reserve, kind: "reserve", reserve, base, source };
  };
  const fixed = (tokens: number, source: CompactionTrigger["source"]): CompactionTrigger =>
    tokens >= window
      ? { ...byReserve(window, null, source), capped: true }
      : { ...none, tokens, kind: "fixed", source };
  const percentOf = (size: number, percent: number, base: number | null, source: CompactionTrigger["source"]) => {
    const clamped = clampPercent(percent);
    return {
      ...none,
      tokens: Math.floor((size * clamped) / 100),
      kind: "percent",
      percent: clamped,
      base,
      source,
    } as const;
  };

  const entry = settings.modelThresholdsEnabled ? matchModelThreshold(settings.modelThresholds, key) : undefined;
  if (typeof entry === "number" && entry > 0) {
    return settings.thresholdPercent > 0
      ? percentOf(entry, settings.thresholdPercent, entry, "model")
      : byReserve(entry, entry, "model");
  }
  if (typeof entry === "string") {
    const fixedMatch = /^f(\d+)$/i.exec(entry.trim());
    if (fixedMatch) return fixed(Number(fixedMatch[1]), "model");
    const percentMatch = /^(\d+(?:\.\d+)?)%$/.exec(entry.trim());
    if (percentMatch) return percentOf(window, Number(percentMatch[1]), null, "model");
  }

  const source = settings.source;
  if (settings.thresholdTokens > 0) return fixed(settings.thresholdTokens, source);
  if (settings.thresholdPercent > 0) return percentOf(window, settings.thresholdPercent, null, source);
  return byReserve(window, null, source);
}
