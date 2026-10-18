// Markdown 解析：markdown-it（html:false，原始 HTML 当文本）→ 顶层块列表。
// 纯 TS，不碰 DOM：渲染进程和 vitest（test/markdown.test.ts）共用。
import MarkdownIt from "markdown-it";

export type Token = ReturnType<InstanceType<typeof MarkdownIt>["parse"]>[number];

/** html:false 让 <script>、<img onerror> 这类原始 HTML 变成普通文本；linkify 关闭，只认显式链接。 */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

export interface MarkdownBlock {
  /** 块的原文；memo 的比较依据，已闭合的块原文不再变化。 */
  src: string;
  tokens: Token[];
  /** fence 块的围栏是否已闭合（流式中未闭合不高亮）；其它块恒为 true。 */
  closed: boolean;
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

/** 把整篇 Markdown 切成顶层块。每块带自己的 token 子序列，渲染时只看块。 */
export function parseBlocks(source: string): MarkdownBlock[] {
  const tokens = md.parse(source, {});
  extractTaskMarkers(tokens);
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
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
    blocks.push({
      src,
      tokens: tokens.slice(start, end),
      closed: first.type === "fence" ? fenceClosed(src, first.markup) : true,
    });
    start = end;
  }
  return blocks;
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
  if (last !== "" && ambiguousStart.test(last)) return lines.slice(0, lastIndex).join("\n") + (lastIndex > 0 ? "\n" : "");
  return source;
}
