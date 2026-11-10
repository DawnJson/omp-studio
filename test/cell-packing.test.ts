// 设置页格子的排法（shared/ui/cell-packing.ts）：占几列、往前面行的空位里填、行里不留空位。
import { describe, expect, it } from "vitest";
import { cellSpan, packCells } from "../src/shared/ui/cell-packing.ts";

// 列宽 300、间距 24：一格放得下 ≤300，两格 ≤624，三格 ≤948。
const pack = (widths: number[], cols = 3) => packCells(widths, cols, 300, 24);

describe("cellSpan", () => {
  it("按不折行的宽占列，正好放得下不多占，最多占满一行", () => {
    expect(cellSpan(300, 3, 300, 24)).toBe(1);
    expect(cellSpan(301, 3, 300, 24)).toBe(2);
    expect(cellSpan(624, 3, 300, 24)).toBe(2);
    expect(cellSpan(625, 3, 300, 24)).toBe(3);
    expect(cellSpan(5000, 3, 300, 24)).toBe(3);
  });
});

describe("packCells", () => {
  it("都是窄的：原顺序，按列数折行", () => {
    const result = pack([100, 100, 100, 100]);
    expect(result.order).toEqual([0, 1, 2, 3]);
    expect(result.rows).toBe(2);
  });

  it("宽的这一行放不下就往后挪，后面窄的补上前面行的空位", () => {
    // 窄 窄 宽(2) 窄 窄：第一行剩 1 列放不下宽的 -> 宽的开第二行；第四项补第一行，第五项跟在宽的后面。
    const result = pack([100, 100, 500, 100, 100]);
    expect(result.spans).toEqual([1, 1, 2, 1, 1]);
    expect(result.order).toEqual([0, 1, 3, 2, 4]);
    expect(result.rows).toBe(2);
  });

  it("只占一行、没填满：报出用了几列（小组可以和别的小组并排）", () => {
    expect(pack([100]).used).toBe(1);
    expect(pack([100, 500]).used).toBe(3);
    const two = pack([500, 100, 100]);
    expect(two.rows).toBe(2);
  });

  it("没有列宽（还没布局）时每格占一列", () => {
    expect(packCells([500, 900], 2, 0, 24).spans).toEqual([1, 1]);
  });
});
