import { describe, expect, it } from "vitest";
import { codeLineNumbers, codeRows } from "../src/shared/tsp/code-rows.ts";

// grep / 分段 read 的输出（omp 18.14.2 起）：一个 code 块用 nums 给不连续的行号，mark.line 也按 nums 算。
describe("code 节点 nums", () => {
  it("nums 有效时按它编号，跳跃处插 … 间隔行，标记按同一套行号匹配", () => {
    const nums = codeLineNumbers(5, 1, [3, 4, 9, 120, 121]);
    expect(nums).toEqual([3, 4, 9, 120, 121]);
    const rows = codeRows(nums, 5, [{ line: 9, tone: "accent" }, { line: 120 }, { line: 4, heat: 0.8 }]);
    expect(rows).toEqual([
      { kind: "line", index: 0, num: 3, mark: undefined },
      // 只有 heat 的标记不画色条
      { kind: "line", index: 1, num: 4, mark: undefined },
      { kind: "gap", num: 9 },
      { kind: "line", index: 2, num: 9, mark: "accent" },
      { kind: "gap", num: 120 },
      // 没 tone 也没 heat / wash 默认 accent
      { kind: "line", index: 3, num: 120, mark: "accent" },
      { kind: "line", index: 4, num: 121, mark: undefined },
    ]);
  });

  it("预览只取头几行时间隔行也只到这几行", () => {
    const rows = codeRows([3, 9, 10], 2, []);
    expect(rows.map((row) => row.kind)).toEqual(["line", "gap", "line"]);
  });

  it("nums 长度不符或不严格递增就忽略，从 start 数", () => {
    expect(codeLineNumbers(3, 7, [1, 2])).toEqual([7, 8, 9]);
    expect(codeLineNumbers(3, 7, [1, 5, 5])).toEqual([7, 8, 9]);
    expect(codeLineNumbers(2, 7, [4, 2])).toEqual([7, 8]);
    expect(codeLineNumbers(2, 7, undefined)).toEqual([7, 8]);
    expect(codeRows(codeLineNumbers(3, 7, [1, 2]), 3, []).some((row) => row.kind === "gap")).toBe(false);
  });
});
