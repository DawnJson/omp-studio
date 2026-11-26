// 文字变化只动变的那部分：新旧文字比对（shared/ui/rolling-text.ts）。
import { describe, expect, it } from "vitest";
import { rollParts } from "../src/shared/ui/rolling-text.ts";

describe("rollParts", () => {
  it("没变就整段不动", () => {
    expect(rollParts("765k", "765k")).toEqual(["765k"]);
  });

  it("只有个位变了：只滚那一位，变大是 inc", () => {
    expect(rollParts("765k", "768k")).toEqual(["76", { from: "5", to: "8", motion: "inc", delayMs: 0 }, "k"]);
  });

  it("进位：从右往左每位晚 35ms，方向按第一串变了的数字", () => {
    expect(rollParts("1h59m", "2h00m")).toEqual([
      { from: "1", to: "2", motion: "inc", delayMs: 0 },
      "h",
      { from: "5", to: "0", motion: "inc", delayMs: 35 },
      { from: "9", to: "0", motion: "inc", delayMs: 0 },
      "m",
    ]);
  });

  it("变小是 dec；位数变多时新的高位从空白滚出来", () => {
    expect(rollParts("10/12", "9/12")).toEqual([
      { from: "1", to: "", motion: "dec", delayMs: 35 },
      { from: "0", to: "9", motion: "dec", delayMs: 0 },
      "/12",
    ]);
    expect(rollParts("9%", "19%")).toEqual([{ from: "", to: "1", motion: "inc", delayMs: 35 }, "9%"]);
  });

  it("头尾不切在数字中间：119 → 120 整串比较，不是 19 → 20 以外的拼法", () => {
    expect(rollParts("119", "120")).toEqual([
      "1",
      { from: "1", to: "2", motion: "inc", delayMs: 35 },
      { from: "9", to: "0", motion: "inc", delayMs: 0 },
    ]);
  });

  it("不只是数字变了：中间整段换掉", () => {
    expect(rollParts("读取 config.ts", "编辑 config.ts")).toEqual([
      { from: "读取", to: "编辑", motion: "swap", delayMs: 0 },
      " config.ts",
    ]);
    expect(rollParts("1.2k tok", "980 tok")).toEqual([{ from: "1.2k", to: "980", motion: "swap", delayMs: 0 }, " tok"]);
  });
});
