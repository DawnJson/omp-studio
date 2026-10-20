// markdown-it 公式插件：只负责识别分隔符，产出 math_inline / math_block token（content 为公式源码，markup 为开分隔符）。
// 行内：$…$、\(…\)；块：$$…$$、\[…\]。公式本身由 render.ts 交给 KaTeX。
// 未闭合的分隔符不匹配，保持普通文字——流式中公式还没写完时就是这样显示。
import type { MarkdownIt, StateBlock, StateInline } from "markdown-it";

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** pos 之前连续反斜杠的个数是奇数，说明 pos 处的字符被转义。 */
function isEscaped(src: string, pos: number): boolean {
  let count = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === BACKSLASH; i -= 1) count += 1;
  return count % 2 === 1;
}

/** 行内 $…$：pandoc 规则——开 $ 后紧跟非空白，闭 $ 前非空白且后面不是数字；"$5 and $10" 因此不是公式。 */
function findDollarClose(src: string, from: number, max: number): number {
  for (let i = from; i < max; i += 1) {
    if (src.charCodeAt(i) !== DOLLAR || isEscaped(src, i)) continue;
    if (isSpace(src.charCodeAt(i - 1))) continue;
    const next = i + 1 < max ? src.charCodeAt(i + 1) : 0;
    if (isDigit(next) || next === DOLLAR) continue;
    return i;
  }
  return -1;
}

function findParenClose(src: string, from: number, max: number): number {
  for (let i = from; i + 1 < max; i += 1) {
    if (src.charCodeAt(i) === BACKSLASH && src.charCodeAt(i + 1) === 0x29 && !isEscaped(src, i)) return i;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  const code = src.charCodeAt(pos);
  let open: string;
  let close: number;
  if (code === DOLLAR) {
    const next = src.charCodeAt(pos + 1);
    if (pos + 1 >= posMax || isSpace(next) || next === DOLLAR) return false;
    if (pos > 0 && src.charCodeAt(pos - 1) === DOLLAR) return false;
    open = "$";
    close = findDollarClose(src, pos + 1, posMax);
  } else if (code === BACKSLASH && src.charCodeAt(pos + 1) === 0x28) {
    open = "\\(";
    close = findParenClose(src, pos + 2, posMax);
  } else {
    return false;
  }
  if (close < 0) return false;
  const content = src.slice(pos + open.length, close);
  if (content.trim() === "") return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.markup = open;
  }
  state.pos = close + (open === "$" ? 1 : 2);
  return true;
}

const blockDelimiters: ReadonlyArray<readonly [open: string, close: string]> = [
  ["$$", "$$"],
  ["\\[", "\\]"],
];

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const first = state.src.slice(start, state.eMarks[startLine]!);
  const delimiter = blockDelimiters.find(([open]) => first.startsWith(open));
  if (!delimiter) return false;
  const [open, close] = delimiter;
  const rest = first.slice(open.length).trimEnd();

  let lastLine = startLine;
  let content: string;
  if (rest.endsWith(close)) {
    content = rest.slice(0, -close.length);
  } else {
    // 多行：找到以闭分隔符结尾的行；遇到空行就放弃，避免一个没写完的 $$ 吞掉后面整段。
    let found = -1;
    for (let line = startLine + 1; line < endLine; line += 1) {
      const text = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!).trimEnd();
      if (text === "") break;
      if (text.endsWith(close)) {
        found = line;
        break;
      }
    }
    if (found < 0) return false;
    lastLine = found;
    const body = state.getLines(startLine + 1, found + 1, state.blkIndent, false).trimEnd();
    content = `${rest}\n${body.slice(0, -close.length)}`;
  }
  if (content.trim() === "") return false;
  if (silent) return true;
  state.line = lastLine + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content.trim();
  token.markup = open;
  token.map = [startLine, state.line];
  return true;
}

export function mathPlugin(md: MarkdownIt): void {
  // 行内规则放在 escape 之前，否则 \( 会先被当作转义；\$ 不匹配本规则，仍由 escape 处理。
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
}
