// omp 往 eval 卡片的代码节点里边生成边追加文字：新高亮没回来前，已着色的字要保持着色（不能退回纯文本再变绿，来回闪），
// 新追加的字无色，而且拼出来的文字必须和新代码逐字一致。
import { describe, expect, it } from "vitest";
import { carryHighlight, type HighlightToken } from "../src/renderer/src/markdown/highlight-tokens.ts";

const tok = (text: string, color?: string): HighlightToken => ({
  text,
  italic: false,
  bold: false,
  ...(color !== undefined && { color }),
});
const text = (lines: HighlightToken[][]) => lines.map((line) => line.map((token) => token.text).join("")).join("\n");

describe("carryHighlight", () => {
  const previous = [
    [tok("x", "var(--v)"), tok(" = "), tok('"桦木"', "var(--s)")],
    [tok("print", "var(--f)"), tok("("), tok('"a', "var(--s)")],
  ];

  it("追加：没变的行照旧着色，上一次那行后面多出来的字和新行无色", () => {
    const code = 'x = "桦木"\nprint("ab")\ny = 1';
    const carried = carryHighlight(previous, code);
    expect(text(carried)).toBe(code);
    expect(carried[0]).toBe(previous[0]);
    expect(carried[1]!.slice(0, 3)).toEqual(previous[1]);
    expect(carried[1]![3]).toEqual(tok('b")'));
    expect(carried[2]).toEqual([tok("y = 1")]);
  });

  it("中间改了的行不拿旧 token 盖新文字：整行无色", () => {
    const code = 'x = "松木"\nprint("a';
    const carried = carryHighlight(previous, code);
    expect(text(carried)).toBe(code);
    expect(carried[0]).toEqual([tok('x = "松木"')]);
    expect(carried[1]).toBe(previous[1]);
  });

  it("代码变短：多出来的旧行丢掉", () => {
    const carried = carryHighlight(previous, 'x = "桦木"');
    expect(carried).toEqual([previous[0]]);
  });
});
