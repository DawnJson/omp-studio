// Markdown 解析：markdown-it（html:false，原始 HTML 当文本）→ 顶层块列表。
// 纯 TS，不碰 DOM：渲染进程和 vitest（test/markdown.test.ts）共用。
import { mathPlugin } from "./math.ts";
import MarkdownIt from "markdown-it";

export type Token = ReturnType<InstanceType<typeof MarkdownIt>["parse"]>[number];

/**
 * html:false 让 <script>、<img onerror> 这类原始 HTML 变成普通文本。
 * linkify 只认写全的 http(s) 网址（模型常直接输出裸网址，2026-10-25 起可点）：不猜 `example.com`、邮箱、IP，
 * 去掉 ftp: / mailto: / 协议相对的 `//`，和 render.ts 只放行 http/https 一致。
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
md.linkify
  .set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
  .add("ftp:", null)
  .add("//", null)
  .add("mailto:", null);
md.use(mathPlugin);
// file: 链接也放行（模型常给 `[报告](file:///C:/…)`，默认规则把它当原文）；只有调用方给了 openFile 时 render.ts 才画成链接。
// javascript: / vbscript: / 非图片的 data: 仍由默认规则挡掉。
const defaultValidateLink = md.validateLink;
md.validateLink = (url) => /^file:/i.test(url) || defaultValidateLink(url);

export interface MarkdownBlock {
  /** 块的原文；memo 的比较依据，已闭合的块原文不再变化。 */
  src: string;
  tokens: Token[];
  /** fence 块的围栏是否已闭合（流式中未闭合不高亮）；其它块恒为 true。 */
  closed: boolean;
  /** 块里有公式 token（KaTeX 按需加载，加载完只重画这些块）。 */
  math: boolean;
}

const fenceClose = /^ {0,3}(`{3,}|~{3,})\s*$/;

function fenceClosed(src: string, markup: string): boolean {
  const lines = src.replace(/\n$/, "").split("\n");
  if (lines.length < 2) return false;
  const last = fenceClose.exec(lines[lines.length - 1] ?? "");
  return last !== null && (last[1]?.length ?? 0) >= markup.length && last[1]?.[0] === markup[0];
}

const taskMarker = /^\[([ xX])\]\s+/;

/** 任务列表：把列表项开头的 [ ] / [x] 从文字里摘掉，记在 list_item_open 的 data-task 上。解析时做一次，渲染保持纯函数。 */
function extractTaskMarkers(tokens: Token[]): void {
  tokens.forEach((token, index) => {
    if (token.type !== "list_item_open") return;
    const inline = tokens[index + 2];
    if (tokens[index + 1]?.type !== "paragraph_open" || inline?.type !== "inline") return;
    const marker = taskMarker.exec(inline.content);
    const first = inline.children?.[0];
    if (!marker || first?.type !== "text") return;
    token.attrSet("data-task", marker[1] === " " ? "open" : "done");
    inline.content = inline.content.replace(taskMarker, "");
    first.content = first.content.replace(taskMarker, "");
  });
}

function hasMath(tokens: readonly Token[]): boolean {
  return tokens.some(
    (token) =>
      token.type === "math_block" ||
      (token.type === "inline" && (token.children ?? []).some((child) => child.type === "math_inline")),
  );
}

interface BlockStart {
  /** 块首行的行号和字符偏移。 */
  line: number;
  offset: number;
  /** 前一行是空行：只有这样的块首才能当增量解析的切点。 */
  blankBefore: boolean;
}

/** 一次解析的结果；流式时下一次解析拿它复用前面不会再变的块（parseStreaming）。 */
export interface BlockParse {
  source: string;
  blocks: MarkdownBlock[];
  starts: BlockStart[];
}

const blankLine = /^[ \t]*$/;

/** 从第 line 行（字符偏移 offset，前一行是空行）解析到末尾；token.map 和块首行号都换算成整篇的行号。 */
function parseFrom(source: string, line: number, offset: number): { blocks: MarkdownBlock[]; starts: BlockStart[] } {
  const text = offset === 0 ? source : source.slice(offset);
  const tokens = md.parse(text, {});
  extractTaskMarkers(tokens);
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  const starts: BlockStart[] = [];
  // 按行前进的游标：块首行号递增，顺带算出块首的字符偏移。
  let cursorLine = 0;
  let cursorOffset = offset;
  let start = 0;
  while (start < tokens.length) {
    const first = tokens[start];
    if (!first) break;
    let end = start + 1;
    if (first.nesting === 1) {
      let depth = 1;
      while (end < tokens.length && depth > 0) {
        depth += tokens[end]?.nesting ?? 0;
        end += 1;
      }
    }
    const map = first.map;
    const src = map ? lines.slice(map[0], map[1]).join("\n") : "";
    const blockTokens = tokens.slice(start, end);
    blocks.push({
      src,
      tokens: blockTokens,
      closed: first.type === "fence" ? fenceClosed(src, first.markup) : true,
      math: hasMath(blockTokens),
    });
    if (map) {
      while (cursorLine < map[0]) {
        cursorOffset += (lines[cursorLine]?.length ?? 0) + 1;
        cursorLine += 1;
      }
      const blankBefore = map[0] === 0 ? line > 0 : blankLine.test(lines[map[0] - 1] ?? "");
      starts.push({ line: map[0] + line, offset: cursorOffset, blankBefore });
    } else {
      starts.push({ line: -1, offset: -1, blankBefore: false });
    }
    start = end;
  }
  if (line > 0) {
    for (const token of tokens) {
      if (token.map) token.map = [token.map[0] + line, token.map[1] + line];
    }
  }
  return { blocks, starts };
}

/** 把整篇 Markdown 切成顶层块。每块带自己的 token 子序列，渲染时只看块。 */
export function parseBlocks(source: string): MarkdownBlock[] {
  return parseFrom(source, 0, 0).blocks;
}

/**
 * 流式增量解析：结果与 parseBlocks(source) 相同，但复用 prev 里不会再变的块（同一个对象），只重解析尾巴。
 *
 * 切点取 prev 里最后一个"前一行是空行"的顶层块首行 s，且新旧原文到第 s 行行尾为止完全相同。
 * 理由：markdown-it 判断第 s 行之前的块在哪结束，只看到第 s 行为止的内容（段落、表格、引用、公式块遇空行即止；
 * 围栏、缩进代码、列表跨空行时第 s 行就不会是新的顶层块）；从第 s 行起的解析状态是"空行后的顶层"，与单独解析尾巴一样。
 * 唯一跨块的全局状态是链接引用定义（`[x]: url`，可以在后面定义、前面使用），原文里有 `]:` 就整篇重解析；
 * 含 `\r` 时 markdown-it 的行号和按 `\n` 切的行对不上，也整篇重解析。
 */
export function parseStreaming(prev: BlockParse | null, source: string): BlockParse {
  if (prev !== null && !source.includes("\r") && !source.includes("]:")) {
    const old = prev.source;
    let common = old.length;
    if (!source.startsWith(old)) {
      common = 0;
      const limit = Math.min(old.length, source.length);
      while (common < limit && old.charCodeAt(common) === source.charCodeAt(common)) common += 1;
    }
    for (let k = prev.starts.length - 1; k >= 1; k -= 1) {
      const start = prev.starts[k]!;
      if (!start.blankBefore) continue;
      const newline = old.indexOf("\n", start.offset);
      const lineEnd = newline < 0 ? old.length : newline;
      // 第 s 行在新原文里必须一字不差（同一处换行结束，或同样是最后一行）。
      if (lineEnd > common || (lineEnd < source.length && source.charCodeAt(lineEnd) !== 0x0a)) continue;
      const tail = parseFrom(source, start.line, start.offset);
      return {
        source,
        blocks: prev.blocks.slice(0, k).concat(tail.blocks),
        starts: prev.starts.slice(0, k).concat(tail.starts),
      };
    }
  }
  return { source, ...parseFrom(source, 0, 0) };
}

const tableDelimiter = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const ambiguousStart = /^\s{0,3}([|#>*+-]|\d+[.)]|`{1,3}|~{1,3})/;
const fenceLine = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 流式时把"还不知道会变成什么"的尾巴先藏起来（spec 5.4 第 2 条）：
 * 行首是 | # > - * 1. 或围栏的未完成行，等该行结束再渲染；表头行要等分隔行到了才出现。
 * 这样界面上不会先出现一段普通文字，再变成表头或列表。
 */
export function stabilizeStreaming(source: string): string {
  const lines = source.split("\n");
  let inFence = false;
  for (const line of lines.slice(0, -1)) {
    if (fenceLine.test(line)) inFence = !inFence;
  }
  const lastIndex = lines.length - 1;
  const last = lines[lastIndex] ?? "";
  if (inFence) {
    // 围栏内的内容照常显示；只有可能是关闭围栏的未完成行先等一下。
    return /^\s{0,3}[`~]{1,}\s*$/.test(last) ? lines.slice(0, lastIndex).join("\n") + "\n" : source;
  }
  // 表：尾部连续以 | 开头的行，要有"表头 + 分隔行"才放出。
  const runEnd = last === "" ? lastIndex : lines.length;
  let runStart = runEnd;
  while (runStart > 0 && (lines[runStart - 1] ?? "").trimStart().startsWith("|")) runStart -= 1;
  if (runStart < runEnd) {
    const second = lines[runStart + 1];
    const hasDelimiter = second !== undefined && runStart + 1 < lastIndex && tableDelimiter.test(second);
    if (!hasDelimiter) return runStart === 0 ? "" : lines.slice(0, runStart).join("\n") + "\n";
  }
  if (last !== "" && ambiguousStart.test(last))
    return lines.slice(0, lastIndex).join("\n") + (lastIndex > 0 ? "\n" : "");
  return source;
}
