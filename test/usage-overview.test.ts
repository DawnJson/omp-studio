import { describe, expect, it } from "vitest";
import {
  dotCount,
  MAX_DOTS,
  OVERVIEW_WEEKS,
  usageOverview,
} from "../src/renderer/src/features/empty/usage-overview.ts";

const day = (date: string, tokens: number, costUsd = 0) => ({ date, requests: 1, tokens, costUsd });

describe("dotCount", () => {
  it("按最多那天等比四舍五入，有用量至少 1 个点", () => {
    expect(dotCount(0, 100)).toBe(0);
    expect(dotCount(5, 0)).toBe(0);
    expect(dotCount(100, 100)).toBe(MAX_DOTS);
    expect(dotCount(50, 100)).toBe(3);
    expect(dotCount(1, 1000)).toBe(1);
  });
});

describe("usageOverview", () => {
  it("近 7 天合计、今天、点阵列", () => {
    const overview = usageOverview({
      to: "2026-03-02",
      days: [
        day("2026-03-02", 42_000, 0.5),
        day("2026-02-28", 100_000, 1),
        day("2026-02-24", 8_000, 0.25),
        // 第 8 天前，不算进本周，但参与点阵高度
        day("2026-02-23", 200_000, 9),
        day("2025-12-01", 999_999_999),
      ],
    });
    expect(overview.weekTokens).toBe(150_000);
    expect(overview.weekCost).toBeCloseTo(1.75);
    expect(overview.todayTokens).toBe(42_000);
    expect(overview.columns).toHaveLength(OVERVIEW_WEEKS * 7);
    const last = overview.columns.at(-1);
    expect(last).toMatchObject({ date: "2026-03-02", recent: true, dots: 1 });
    const byDate = new Map(overview.columns.map((column) => [column.date, column]));
    expect(byDate.get("2026-02-23")).toMatchObject({ recent: false, dots: MAX_DOTS });
    expect(byDate.get("2026-02-24")).toMatchObject({ recent: true, dots: 1 });
    expect(byDate.get("2026-02-28")).toMatchObject({ recent: true, dots: 3 });
    expect(byDate.get("2026-03-01")).toMatchObject({ tokens: 0, dots: 0 });
    expect(overview.columns.filter((column) => column.recent)).toHaveLength(7);
  });

  it("没有数据：全空的点阵，合计 0", () => {
    const overview = usageOverview({ to: "2026-01-03", days: [] });
    expect(overview.weekTokens).toBe(0);
    expect(overview.todayTokens).toBe(0);
    expect(overview.columns[0]?.date).toBe("2025-10-12");
    expect(overview.columns.every((column) => column.dots === 0)).toBe(true);
  });
});
