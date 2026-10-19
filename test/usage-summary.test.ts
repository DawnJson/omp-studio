// 用量页汇总（shared/ui/usage-summary.ts）：30 天与一年的边界、最忙的一天、活跃天数、连续天数、最紧的额度。
import { describe, expect, it } from "vitest";
import type { QuotaAccount, QuotaLimit, UsageDay, UsageHeatmap } from "../src/shared/ipc.ts";
import {
  activityStats,
  isUntouched,
  leftPercent,
  summarizeUsage,
  tightestQuota,
} from "../src/shared/ui/usage-summary.ts";

const day = (date: string, costUsd: number, requests = 1): UsageDay => ({
  date,
  requests,
  tokens: requests * 10,
  costUsd,
});
const heatmap = (days: UsageDay[], from = "2025-10-20", to = "2026-10-19"): UsageHeatmap => ({
  from,
  to,
  days,
  hasDatabase: true,
});

describe("summarizeUsage", () => {
  it("最近 30 天含 to 当天，第 31 天只算进一年", () => {
    const summary = summarizeUsage(
      heatmap([
        day("2026-10-19", 1, 2),
        day("2026-09-20", 10, 3),
        day("2026-09-19", 100, 4),
        day("2025-10-20", 1000, 5),
      ]),
    );
    expect(summary.last30).toEqual({ costUsd: 11, requests: 5 });
    expect(summary.pastYear).toEqual({ costUsd: 1111, requests: 14 });
    expect(summary.spark).toHaveLength(30);
    expect(summary.spark[29]).toBe(1);
    expect(summary.spark[0]).toBe(10);
  });

  it("最忙的一天按花费，没有记录时是 null", () => {
    expect(
      summarizeUsage(heatmap([day("2026-01-01", 5), day("2026-01-02", 9), day("2026-01-03", 2)])).busiest?.date,
    ).toBe("2026-01-02");
    expect(summarizeUsage(heatmap([])).busiest).toBeNull();
  });
});

describe("activityStats", () => {
  it("活跃天数不含全 0 的日子，连续天数中间断一天就重算", () => {
    const stats = activityStats([
      day("2026-03-01", 1),
      day("2026-03-02", 1),
      day("2026-03-03", 0, 0),
      day("2026-03-04", 1),
      day("2026-03-05", 1),
      day("2026-03-06", 1),
    ]);
    expect(stats).toEqual({ activeDays: 5, longestStreak: 3 });
  });

  it("跨年和跨月照样连续，传入顺序无关", () => {
    const stats = activityStats([
      day("2026-01-01", 1),
      day("2025-12-30", 1),
      day("2025-12-31", 1),
      day("2026-01-03", 1),
    ]);
    expect(stats).toEqual({ activeDays: 4, longestStreak: 3 });
  });
});

const limit = (id: string, usedFraction: number | null, status: QuotaLimit["status"] = "ok"): QuotaLimit => ({
  id,
  label: id,
  windowLabel: null,
  usedFraction,
  resetsAt: null,
  status,
});
const account = (provider: string, limits: QuotaLimit[]): QuotaAccount => ({
  provider,
  account: null,
  limits,
  notes: [],
  fetchedAt: 0,
});

describe("quota helpers", () => {
  it("最紧的额度取比例最大的，忽略没给比例的", () => {
    const found = tightestQuota([
      account("a", [limit("a1", 0.2), limit("a2", null)]),
      account("b", [limit("b1", 0.24), limit("b2", null)]),
    ]);
    expect(found?.limit.id).toBe("b1");
    expect(found?.account.provider).toBe("b");
    expect(tightestQuota([account("a", [limit("a1", null)])])).toBeNull();
    expect(tightestQuota([])).toBeNull();
  });

  it("没动过的账号：比例 0 或没给，且没用尽", () => {
    expect(isUntouched(account("a", [limit("1", 0), limit("2", null)]))).toBe(true);
    expect(isUntouched(account("a", [limit("1", 0.01)]))).toBe(false);
    expect(isUntouched(account("a", [limit("1", null, "exhausted")]))).toBe(false);
  });

  it("剩余百分比：用尽为 0，没给比例为 null，超过 100% 不为负", () => {
    expect(leftPercent(limit("1", 0.24))).toBe(76);
    expect(leftPercent(limit("1", 1.3))).toBe(0);
    expect(leftPercent(limit("1", null, "exhausted"))).toBe(0);
    expect(leftPercent(limit("1", null))).toBeNull();
  });
});
