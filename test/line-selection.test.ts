import { describe, expect, it } from "vitest";
import { extendToLine, moveSelection, toggleLine } from "../src/shared/ui/line-selection.ts";

// 下标：0 上下文，1 删除，2 新增，3 新增，4 上下文，5 删除
const changed = [false, true, true, true, false, true];

describe("按行选择", () => {
  it("点击切换：选中、取消；上下文行不处理；换了 hunk 重新开始", () => {
    const one = toggleLine(null, 0, 2, changed);
    expect(one).toMatchObject({ hunk: 0, lines: [2] });
    const two = toggleLine(one, 0, 5, changed);
    expect(two?.lines).toEqual([2, 5]);
    expect(toggleLine(two, 0, 2, changed)?.lines).toEqual([5]);
    expect(toggleLine(toggleLine(two, 0, 2, changed), 0, 5, changed)).toBeNull();
    expect(toggleLine(two, 0, 0, changed)).toBe(two);
    expect(toggleLine(two, 1, 3, changed)).toMatchObject({ hunk: 1, lines: [3] });
  });

  it("Shift 点击：从起点选到这一行，范围里的上下文行跳过", () => {
    const start = toggleLine(null, 0, 1, changed);
    expect(extendToLine(start, 0, 5, changed)?.lines).toEqual([1, 2, 3, 5]);
    expect(extendToLine(start, 0, 3, changed)?.lines).toEqual([1, 2, 3]);
    // 没有起点（或在别的 hunk）时等同于点击这一行。
    expect(extendToLine(null, 0, 3, changed)).toMatchObject({ lines: [3] });
    expect(extendToLine(start, 1, 3, changed)).toMatchObject({ hunk: 1, lines: [3] });
  });

  it("Shift+↓ / ↑：没有选择时从第一个 / 最后一个改动行开始，之后端点逐行移动", () => {
    const first = moveSelection(null, 0, 1, changed);
    expect(first).toMatchObject({ anchor: 1, cursor: 1, lines: [1] });
    const next = moveSelection(first, 0, 1, changed);
    expect(next?.lines).toEqual([1, 2]);
    // 端点走到上下文行：选中的还是两者之间的改动行。
    const atContext = moveSelection(moveSelection(next, 0, 1, changed), 0, 1, changed);
    expect(atContext).toMatchObject({ cursor: 4, lines: [1, 2, 3] });
    // 往回收。
    expect(moveSelection(atContext, 0, -1, changed)).toMatchObject({ cursor: 3, lines: [1, 2, 3] });
    expect(moveSelection(null, 0, -1, changed)).toMatchObject({ anchor: 5, lines: [5] });
    // 到头不越界；没有改动行时没有选择。
    let edge = moveSelection(null, 0, -1, changed);
    for (let i = 0; i < 10; i++) edge = moveSelection(edge, 0, 1, changed);
    expect(edge?.cursor).toBe(5);
    expect(moveSelection(null, 0, 1, [false, false])).toBeNull();
  });
});
