import { describe, expect, it } from "vitest";
import { alignTurnCost, formatExactCost, withExactCost } from "../src/renderer/src/features/tsp/turn-cost.ts";

describe("每轮用量行的准确费用", () => {
  it("从末尾对齐：最后一行对最后一个数", () => {
    const costs = [0.5, 0.0031, 0.0042];
    expect(alignTurnCost(costs, 0)).toBe(0.0042);
    expect(alignTurnCost(costs, 1)).toBe(0.0031);
    expect(alignTurnCost(costs, 2)).toBe(0.5);
  });

  it("对不上（数组短 / 位置无效 / 不是正数）返回 undefined", () => {
    expect(alignTurnCost([0.003], 1)).toBeUndefined();
    expect(alignTurnCost([], 0)).toBeUndefined();
    expect(alignTurnCost([0.003], -1)).toBeUndefined();
    expect(alignTurnCost([0], 0)).toBeUndefined();
  });

  it("文字和 title 里的 <$0.01 换成准确费用；对不上保留原文", () => {
    expect(withExactCost("13.4s · 728 tok · <$0.01 this turn", 0.0031)).toBe("13.4s · 728 tok · $0.0031 this turn");
    expect(withExactCost("This turn: 728 tok · <$0.01", 0.0031)).toBe("This turn: 728 tok · $0.0031");
    expect(withExactCost("13.4s · <$0.01 this turn", undefined)).toBe("13.4s · <$0.01 this turn");
    expect(withExactCost("13.4s · $0.42 this turn", 0.0031)).toBe("13.4s · $0.42 this turn");
  });

  it("一分钱以下四位小数，以上两位", () => {
    expect(formatExactCost(0.0031)).toBe("$0.0031");
    expect(formatExactCost(0.42)).toBe("$0.42");
  });
});
