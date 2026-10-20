import { describe, expect, it } from "vitest";
import { BAR_MAX, diffBars } from "../src/renderer/src/features/conversation/diffstat.ts";

const file = (added: number | null, removed: number | null) => ({ path: "a", added, removed });

describe("diffBars", () => {
  it("最大文件 ≤24 行时一行一个字符", () => {
    expect(diffBars([file(20, 4), file(3, 0)])).toEqual([
      { plus: 20, minus: 4 },
      { plus: 3, minus: 0 },
    ]);
  });

  it(">24 时整张卡按同一比例缩小", () => {
    const [big, half] = diffBars([file(40, 8), file(24, 0)]);
    expect(big).toEqual({ plus: 20, minus: 4 });
    expect(half).toEqual({ plus: 12, minus: 0 });
  });

  it("不为 0 的一边至少留 1 个字符，总数不超过 24", () => {
    const [tiny, wide] = diffBars([file(1, 0), file(1000, 1)]);
    expect(tiny).toEqual({ plus: 1, minus: 0 });
    expect(wide!.minus).toBe(1);
    expect(wide!.plus + wide!.minus).toBeLessThanOrEqual(BAR_MAX);
    const [mixed] = diffBars([file(500, 500), file(1, 1)]);
    expect(mixed!.plus + mixed!.minus).toBeLessThanOrEqual(BAR_MAX);
    expect(diffBars([file(1000, 0), file(0, 1)])[1]).toEqual({ plus: 0, minus: 1 });
  });

  it("行数未知不画条，也不参与缩放", () => {
    expect(diffBars([file(null, null), file(5, 1)])).toEqual([null, { plus: 5, minus: 1 }]);
    expect(diffBars([file(null, null)])).toEqual([null]);
  });
});
