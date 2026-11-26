// picker 的档位滑杆（level）和 density 的纯逻辑：格子位置、指针换算成格、热度分段、snug 行高。
import { describe, expect, test } from "vitest";
import {
  buildEntries,
  levelFraction,
  levelHeat,
  levelIndex,
  stepAtPointer,
} from "../src/renderer/src/features/tsp/interactive/picker-model.ts";
import type { TspPickerItem } from "../src/shared/tsp/tsp.generated.ts";

// omp 19.2.1 模型切换器的七格（fixtures/tsp/model-picker-19.jsonl）。
const steps = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"].map((id) => ({ id, label: id }));

describe("level 滑杆", () => {
  test("当前格：value 的下标，不在梯子上时退回第一格", () => {
    expect(levelIndex({ steps, value: "high" })).toBe(5);
    expect(levelIndex({ steps, value: "max" })).toBe(0);
  });

  test("格子均匀分布在轨道上，只有一格时在最右", () => {
    expect(levelFraction(0, 7)).toBe(0);
    expect(levelFraction(3, 7)).toBe(0.5);
    expect(levelFraction(6, 7)).toBe(1);
    expect(levelFraction(0, 1)).toBe(1);
  });

  test("指针位置换成最近的一格，出了轨道两端夹住", () => {
    expect(stepAtPointer(0, 300, 7)).toBe(0);
    expect(stepAtPointer(140, 300, 7)).toBe(3);
    expect(stepAtPointer(299, 300, 7)).toBe(6);
    expect(stepAtPointer(-40, 300, 7)).toBe(0);
    expect(stepAtPointer(900, 300, 7)).toBe(6);
    expect(stepAtPointer(10, 0, 7)).toBe(0);
  });

  test("热度从低到高：前段 cool、中段 warm、最后约四分之一 hot", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => levelHeat(i, 7))).toEqual([
      "cool",
      "cool",
      "cool",
      "warm",
      "warm",
      "hot",
      "hot",
    ]);
    expect(levelHeat(0, 1)).toBe("warm");
  });
});

describe("density snug", () => {
  test("rows 布局 30px 的行、26px 的分组头；regular 是 36 / 32", () => {
    const item = (id: string): TspPickerItem => ({ id, label: id });
    const catalog = new Map([
      ["a", item("a")],
      ["b", item("b")],
    ]);
    const order = [{ group: "recent", label: "Recent" }, "a", "b"];
    expect(buildEntries(catalog, order, "rows", "snug").entries.map((e) => [e.top, e.height])).toEqual([
      [0, 26],
      [26, 30],
      [56, 30],
    ]);
    expect(buildEntries(catalog, order, "rows").total).toBe(32 + 36 * 2);
  });
});
