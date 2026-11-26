// `doc` 节点的纯逻辑（nodes/doc.tsx 用；单测 test/tsp-doc-model.test.ts）：读 props、批注锚点、选区 ↔ 原文偏移。
// 渲染出来的文字和 Markdown 原文不一样（`**`、`|`、链接地址、围栏行），两边都投影成"有效字符"（去掉空白和 Markdown 记号）再比对：
// 选区 → 原文的 quote / at（UTF-16 偏移，omp 的 comment 事件要），批注 → 渲染文字里要高亮的那一段。
import { parseBlocks } from "../../../markdown/parse.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";

export interface DocComment {
  readonly id: string;
  readonly quote: string;
  readonly at: number | undefined;
  readonly note: string;
}

export function readComments(value: unknown): DocComment[] {
  if (!Array.isArray(value)) return [];
  const out: DocComment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, quote, at, note } = item;
    if (typeof id !== "string" || typeof quote !== "string" || typeof note !== "string") continue;
    out.push({ id, quote, at: typeof at === "number" ? at : undefined, note });
  }
  return out;
}

export function readJump(value: unknown): { heading: number; n: number } | null {
  if (!isRecord(value)) return null;
  const { heading, n } = value;
  return typeof heading === "number" && typeof n === "number" ? { heading, n } : null;
}

/** 批注在原文里的位置（规范：`at` 处正好是 quote 就用它，否则 quote 第一次出现的位置）；找不到是 -1。 */
export function commentAnchor(text: string, comment: Pick<DocComment, "quote" | "at">): number {
  if (comment.at !== undefined && comment.at >= 0 && text.startsWith(comment.quote, comment.at)) return comment.at;
  return comment.quote === "" ? -1 : text.indexOf(comment.quote);
}

/** 按锚点排序（找不到锚点的排在最后，保持 omp 给的顺序）。 */
export function sortComments(text: string, comments: readonly DocComment[]): DocComment[] {
  const key = (comment: DocComment) => {
    const at = commentAnchor(text, comment);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  return comments
    .map((comment, index) => ({ comment, index, at: key(comment) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.comment);
}

/** 顶层块（和 Markdown 组件画出来的 `.md-block` 一一对应）在原文里的起点。 */
export function blockStarts(source: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) if (source.charCodeAt(i) === 0x0a) lineStarts.push(i + 1);
  return parseBlocks(source).map((block) => {
    const line = block.tokens?.[0]?.map?.[0];
    return line === undefined ? -1 : (lineStarts[line] ?? source.length);
  });
}

/** 偏移落在第几块（最后一个起点 ≤ offset 的块）。 */
export function blockAt(starts: readonly number[], offset: number): number {
  let found = 0;
  starts.forEach((start, index) => {
    if (start >= 0 && start <= offset) found = index;
  });
  return found;
}

/** 两边都不算的字符：空白和 Markdown 记号（渲染后可能消失或变成别的样子）。 */
const IGNORED = /[\s*_`~#>|[\]\\+=:!-]/;

function isSignificant(char: string): boolean {
  return !IGNORED.test(char);
}

export interface Projection {
  /** 有效字符连成的串。 */
  readonly chars: string;
  /** 每个有效字符在原串里的 UTF-16 偏移。 */
  readonly offsets: readonly number[];
}

/** 渲染文字的投影。 */
function projectText(text: string): Projection {
  let chars = "";
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (!isSignificant(char)) continue;
    chars += char;
    offsets.push(i);
  }
  return { chars, offsets };
}

const fenceLine = /^ {0,3}(`{3,}|~{3,})/;

/** Markdown 原文的投影：另外跳过渲染后看不见的部分（围栏行、链接 / 图片地址 `](…)`）。 */
function projectSource(source: string): Projection {
  let chars = "";
  const offsets: number[] = [];
  let lineStart = 0;
  while (lineStart <= source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd);
    if (!fenceLine.test(line)) {
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === "]" && line[i + 1] === "(") {
          const close = line.indexOf(")", i + 2);
          if (close > 0) {
            i = close;
            continue;
          }
        }
        const char = line[i]!;
        if (!isSignificant(char)) continue;
        chars += char;
        offsets.push(lineStart + i);
      }
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return { chars, offsets };
}

/** haystack 里 needle 离 expected 最近的一次出现的位置；没有是 -1。 */
function nearestOccurrence(haystack: string, needle: string, expected: number): number {
  if (needle === "") return -1;
  let best = -1;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (best < 0 || Math.abs(at - expected) < Math.abs(best - expected)) best = at;
    if (at > expected) break;
  }
  return best;
}

/** 有效字符投影里第一个偏移 ≥ offset 的序号。 */
function projectedIndex(projection: Projection, offset: number): number {
  const index = projection.offsets.findIndex((value) => value >= offset);
  return index < 0 ? projection.chars.length : index;
}

/**
 * 用户选中的渲染文字 → 原文里的 quote 和 at。`hint` 是选区开头所在块在原文里的起点（找最近的那一处，同一句话出现多次时不选错）。
 * 选中的文字原样出现在原文里就用它；否则按有效字符对上原文的一段（跨了 `**`、表格竖线等）；都对不上返回 null。
 */
export function locateSelection(source: string, selected: string, hint: number): { quote: string; at: number } | null {
  const trimmed = selected.trim();
  if (trimmed === "") return null;
  const exact = nearestOccurrence(source, trimmed, hint);
  if (exact >= 0) return { quote: trimmed, at: exact };
  const projection = projectSource(source);
  const needle = projectText(trimmed).chars;
  const found = nearestOccurrence(projection.chars, needle, projectedIndex(projection, hint));
  if (found < 0) return null;
  const at = projection.offsets[found]!;
  const end = projection.offsets[found + needle.length - 1]! + 1;
  return { quote: source.slice(at, end), at };
}

/**
 * 批注在渲染文字里的范围：`rendered` 是锚点所在块起往后的渲染文字（投影前），返回 [起, 止) 的下标；对不上返回 null。
 * `expected` 是锚点在块里的有效字符序号（块起点到锚点之间原文的有效字符数），同一句话出现多次时取最近的。
 */
export function locateComment(
  source: string,
  comment: Pick<DocComment, "quote" | "at">,
  blockStart: number,
  rendered: string,
): { from: number; to: number } | null {
  const anchor = commentAnchor(source, comment);
  if (anchor < 0) return null;
  const needle = projectText(comment.quote).chars;
  const sourceProjection = projectSource(source);
  const expected = projectedIndex(sourceProjection, anchor) - projectedIndex(sourceProjection, blockStart);
  const renderedProjection = projectText(rendered);
  const found = nearestOccurrence(renderedProjection.chars, needle, expected);
  if (found < 0) return null;
  return {
    from: renderedProjection.offsets[found]!,
    to: renderedProjection.offsets[found + needle.length - 1]! + 1,
  };
}
