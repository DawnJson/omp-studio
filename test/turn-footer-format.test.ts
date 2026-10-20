// 防的是：轮尾一行的数字写错——token 的 K/M 进位、费用为 0 时仍显示、不足一分时显示成 $0.00。
import { describe, expect, it } from "vitest";
import { formatTokenCount, formatTurnCost } from "../src/renderer/src/features/conversation/tool-view.ts";

describe("formatTokenCount", () => {
  it("不足 1000 原样，其后 K / M；个位数 K 保留一位小数", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(19_156)).toBe("19K");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(2_340_000)).toBe("2.3M");
  });
});

describe("formatTurnCost", () => {
  it("0 / 未知不显示；不足一分显示 <$0.01；其余两位小数", () => {
    expect(formatTurnCost(0)).toBeNull();
    expect(formatTurnCost(Number.NaN)).toBeNull();
    expect(formatTurnCost(0.000058)).toBe("<$0.01");
    expect(formatTurnCost(0.014)).toBe("$0.01");
    expect(formatTurnCost(1.236)).toBe("$1.24");
  });
});
