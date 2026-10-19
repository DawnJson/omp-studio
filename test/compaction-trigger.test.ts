// 模型选择对话框"压缩于"的计算：和 omp settings.md 的阈值规则一致。
import { describe, expect, it } from "vitest";
import { compactionTrigger, matchModelThreshold } from "../src/shared/compaction-trigger.ts";
import type { CompactionSettings } from "../src/shared/ipc.ts";

const base: CompactionSettings = {
  thresholdTokens: -1,
  thresholdPercent: -1,
  reserveTokens: null,
  modelThresholds: {},
  modelThresholdsEnabled: true,
  source: "global",
};
const opus = { provider: "anthropic", modelId: "claude-opus-5-5" };

describe("compactionTrigger", () => {
  it("全局百分比：窗口的 90%", () => {
    expect(compactionTrigger({ ...base, thresholdPercent: 90 }, opus, 350_000)).toMatchObject({
      tokens: 315_000,
      kind: "percent",
      percent: 90,
      source: "global",
    });
  });

  it("都没设置：窗口减预留，预留取 16384 和 15% 中较大的", () => {
    expect(compactionTrigger(base, opus, 200_000)).toMatchObject({ tokens: 170_000, kind: "reserve", reserve: 30_000 });
    expect(compactionTrigger(base, opus, 64_000)).toMatchObject({ tokens: 64_000 - 16_384, reserve: 16_384 });
  });

  it("固定值优先于百分比；到达窗口时退回窗口减预留", () => {
    const settings = { ...base, thresholdTokens: 100_000, thresholdPercent: 90 };
    expect(compactionTrigger(settings, opus, 350_000)).toMatchObject({ tokens: 100_000, kind: "fixed" });
    expect(compactionTrigger(settings, opus, 80_000)).toMatchObject({ tokens: 80_000 - 16_384, capped: true });
  });

  it("百分比夹到 1–99", () => {
    expect(compactionTrigger({ ...base, thresholdPercent: 150 }, opus, 100_000).tokens).toBe(99_000);
  });

  it("按模型：基数代替窗口并忽略全局固定值，f 前缀是固定值，% 替换全局阈值", () => {
    const withEntry = (entry: number | string) => ({
      ...base,
      thresholdTokens: 50_000,
      thresholdPercent: 80,
      modelThresholds: { "anthropic/claude-opus-5-5": entry },
    });
    expect(compactionTrigger(withEntry(150_000), opus, 350_000)).toMatchObject({
      tokens: 120_000,
      base: 150_000,
      source: "model",
    });
    expect(compactionTrigger(withEntry("f200000"), opus, 350_000)).toMatchObject({ tokens: 200_000, kind: "fixed" });
    expect(compactionTrigger(withEntry("60%"), opus, 350_000)).toMatchObject({ tokens: 210_000, percent: 60 });
    expect(compactionTrigger({ ...withEntry("60%"), modelThresholdsEnabled: false }, opus, 350_000)).toMatchObject({
      tokens: 50_000,
      source: "global",
    });
  });
});

describe("matchModelThreshold", () => {
  it("精确键优先，否则最长的 * 前缀", () => {
    const entries = { "anthropic/*": 1, "anthropic/claude-*": 2, "anthropic/claude-opus-5-5": 3, "openai/*": 4 };
    expect(matchModelThreshold(entries, opus)).toBe(3);
    expect(matchModelThreshold(entries, { provider: "anthropic", modelId: "claude-haiku" })).toBe(2);
    expect(matchModelThreshold(entries, { provider: "anthropic", modelId: "other" })).toBe(1);
    expect(matchModelThreshold(entries, { provider: "deepseek", modelId: "v4" })).toBeUndefined();
  });
});
