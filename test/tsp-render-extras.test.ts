import { describe, expect, it } from "vitest";
import { applyRange, diffSides, lineTokens } from "../src/renderer/src/features/tsp/diff-highlight.ts";
import { parseDiff } from "../src/renderer/src/features/tsp/diff-parse.ts";
import { extentToCss } from "../src/renderer/src/features/tsp/fmt.ts";
import { listWindow, scrollDelta } from "../src/renderer/src/features/tsp/interactive/list-virtual.ts";
import { toolNameOfRole } from "../src/renderer/src/features/tsp/interactive/picker-model.ts";
import { splitMarks } from "../src/renderer/src/markdown/marks.ts";

describe("splitMarks（md.marks：用户消息里的 @文件 / 技能）", () => {
  const marks = [
    { t: "@src/a.ts", className: "ref" },
    { t: "/skill:x", className: "skill" },
  ];

  it("按出现顺序切成普通 / 标记片段", () => {
    expect(splitMarks("看 @src/a.ts 和 /skill:x。", marks)).toEqual([
      { text: "看 " },
      { text: "@src/a.ts", className: "ref" },
      { text: " 和 " },
      { text: "/skill:x", className: "skill" },
      { text: "。" },
    ]);
  });

  it("同一个标记出现多次都命中；没有命中就是原文一段", () => {
    expect(splitMarks("@src/a.ts@src/a.ts", marks)).toEqual([
      { text: "@src/a.ts", className: "ref" },
      { text: "@src/a.ts", className: "ref" },
    ]);
    expect(splitMarks("没有标记", marks)).toEqual([{ text: "没有标记" }]);
    expect(splitMarks("", marks)).toEqual([{ text: "" }]);
  });

  it("同一位置多个标记可匹配时取最长的；空标记忽略", () => {
    const nested = [
      { t: "@a", className: "short" },
      { t: "@a/b", className: "long" },
      { t: "", className: "empty" },
    ];
    expect(splitMarks("x@a/b", nested)).toEqual([{ text: "x" }, { text: "@a/b", className: "long" }]);
  });
});

describe("extentToCss（数字 extent 大于 1 按单位数算）", () => {
  it("宽按字符、高按行；0–1 仍是比例", () => {
    expect(extentToCss(40)).toBe("calc(40 * var(--tsp-cw))");
    expect(extentToCss(12, "h")).toBe("calc(12 * var(--tsp-lh))");
    expect(extentToCss(1)).toBe("100%");
    expect(extentToCss(0.25)).toBe("25%");
    expect(extentToCss(0)).toBeUndefined();
  });
});

describe("listWindow（list.virtual 的可见范围）", () => {
  it("顶部、中间、底部都带上下各 overscan 行", () => {
    expect(listWindow(1000, 30, 0, 300, 4)).toEqual([0, 14]);
    const [from, to] = listWindow(1000, 30, 30 * 500, 300, 4);
    expect(from).toBe(496);
    expect(to).toBe(514);
    expect(listWindow(1000, 30, 30 * 999, 300, 4)[1]).toBe(1000);
  });

  it("没有行 / 行高不对就什么都不画", () => {
    expect(listWindow(0, 30, 0, 300)).toEqual([0, 0]);
    expect(listWindow(10, 0, 0, 300)).toEqual([0, 0]);
  });
});

describe("scrollDelta（选中行滚进视野）", () => {
  it("nearest：已在视野里不动，在上方 / 下方滚最小的量", () => {
    expect(scrollDelta(100, 130, 0, 300, "nearest")).toBe(0);
    expect(scrollDelta(-40, -10, 0, 300, "nearest")).toBe(-40);
    expect(scrollDelta(290, 320, 0, 300, "nearest")).toBe(20);
  });

  it("start / end 对齐到边", () => {
    expect(scrollDelta(100, 130, 0, 300, "start")).toBe(100);
    expect(scrollDelta(100, 130, 0, 300, "end")).toBe(-170);
  });
});

describe("toolNameOfRole（picker 行的前导图标）", () => {
  it("omp.tool.<name> 取工具名，其它 role 是 null", () => {
    expect(toolNameOfRole("omp.tool.grep")).toBe("grep");
    expect(toolNameOfRole("omp.tool.ast-grep.hit")).toBe("ast-grep");
    expect(toolNameOfRole("omp.assistant")).toBeNull();
    expect(toolNameOfRole(undefined)).toBeNull();
  });
});

describe("diff 语法高亮的数据整理", () => {
  const [hunk] = parseDiff("@@ -1,3 +1,3 @@\n keep\n-old()\n+new()\n tail\n");
  const lines = hunk!.lines;
  const tok = (text: string) => ({ text, color: "c", italic: false, bold: false });

  it("旧侧 = 上下文 + 删，新侧 = 上下文 + 增", () => {
    const sides = diffSides(lines);
    expect(sides.oldCode).toBe("keep\nold()\ntail");
    expect(sides.newCode).toBe("keep\nnew()\ntail");
    expect(sides.oldAt.get(lines[1]!)).toBe(1);
    expect(sides.newAt.get(lines[2]!)).toBe(1);
    expect(sides.newAt.get(lines[1]!)).toBeUndefined();
  });

  it("每行取自己那一侧的 token；拼回去和原行对不上就不用", () => {
    const sides = diffSides(lines);
    const oldTokens = [[tok("keep")], [tok("old"), tok("()")], [tok("tail")]];
    const newTokens = [[tok("keep")], [tok("new"), tok("()")], [tok("tail")]];
    expect(lineTokens(lines[1]!, sides, oldTokens, newTokens)?.map((t) => t.text)).toEqual(["old", "()"]);
    expect(lineTokens(lines[2]!, sides, oldTokens, newTokens)?.map((t) => t.text)).toEqual(["new", "()"]);
    expect(lineTokens(lines[2]!, sides, oldTokens, null)).toBeUndefined();
    expect(lineTokens(lines[1]!, sides, [[tok("keep")], [tok("zzz")], [tok("tail")]], newTokens)).toBeUndefined();
  });

  it("词级强调在 token 边界和 token 中间都能切开", () => {
    const pieces = applyRange([tok("let "), tok("value"), tok(" = 1")], { from: 5, to: 8 });
    expect(pieces.map((p) => [p.token.text, p.em])).toEqual([
      ["let ", false],
      ["v", false],
      ["alu", true],
      ["e", false],
      [" = 1", false],
    ]);
    expect(applyRange([tok("abc")], null).map((p) => p.em)).toEqual([false]);
    expect(applyRange([tok("abc")], { from: 1, to: 1 }).map((p) => p.em)).toEqual([false]);
  });
});
