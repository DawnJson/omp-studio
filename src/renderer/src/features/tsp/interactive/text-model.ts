// 交互节点用到的纯文字逻辑：Spans 取纯文本、list 的 filter 高亮范围、输入框背景层的分段。
import type { TspEditorDecoration, TspText } from "../../../../../shared/tsp/tsp.generated.ts";

export type HitRange = readonly [number, number];

export function plainText(text: TspText | undefined): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text.map((span) => span.t).join("");
}

/**
 * list 的 `filter` 命中范围（规范 lists.md「Filter marking」）：查询去首尾空白后不分大小写；
 * 先找整段查询的第一次连续出现，没有就按子序列模糊匹配、相邻命中合并成一段；都没有返回空。
 */
export function filterHits(label: string, query: string): HitRange[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const hay = label.toLowerCase();
  const at = hay.indexOf(q);
  if (at >= 0) return [[at, at + q.length]];
  const runs: [number, number][] = [];
  let from = 0;
  for (const ch of q) {
    const found = hay.indexOf(ch, from);
    if (found < 0) return [];
    const last = runs[runs.length - 1];
    if (last && last[1] === found) last[1] = found + ch.length;
    else runs.push([found, found + ch.length]);
    from = found + ch.length;
  }
  return runs;
}

export interface TextRun {
  from: number;
  to: number;
  /** 覆盖这一段的 decor 的 token，空格分隔，按 decor 顺序合并；没有为空串。 */
  tokens: string;
}

/**
 * 把文字按 decor 边界（越界的钳到文字内）和 `cut`（光标位置）切成连续的段，每段带覆盖它的 decor token。
 * 空范围忽略；重叠按顺序合并 token。
 */
export function splitRuns(length: number, decor: readonly TspEditorDecoration[], cut: number): TextRun[] {
  const clamp = (n: number) => Math.max(0, Math.min(length, Math.floor(n)));
  const spans = decor.map((d) => ({ from: clamp(d.from), to: clamp(d.to), s: d.s })).filter((d) => d.to > d.from);
  const points = new Set<number>([0, length, clamp(cut)]);
  for (const d of spans) {
    points.add(d.from);
    points.add(d.to);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const runs: TextRun[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const from = sorted[i] ?? 0;
    const to = sorted[i + 1] ?? 0;
    const tokens = spans
      .filter((d) => d.from <= from && to <= d.to)
      .map((d) => d.s)
      .join(" ");
    runs.push({ from, to, tokens });
  }
  return runs;
}

/** 偏移钳进 [0, length]；落在代理对中间的往前挪到字符边界（规范 elements-input.md）。 */
export function clampOffset(text: string, offset: number | undefined, fallback: number): number {
  const raw = offset ?? fallback;
  const n = Math.max(0, Math.min(text.length, Math.floor(raw)));
  const code = text.charCodeAt(n);
  const prev = text.charCodeAt(n - 1);
  if (n > 0 && n < text.length && code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff) return n - 1;
  return n;
}
