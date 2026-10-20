// 带命中高亮的 Spans：hits 是在纯文本里的 UTF-16 [from, to) 范围，切开 span 时各段保留自己的样式。
import type { TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { spanClass, TspSpans } from "../spans.tsx";
import type { HitRange } from "./text-model.ts";

interface MarkedTextProps {
  text: TspText | undefined;
  hits?: readonly HitRange[] | undefined;
}

export function MarkedText({ text, hits }: MarkedTextProps) {
  if (hits === undefined || hits.length === 0 || text === undefined) return <TspSpans text={text} />;
  const spans = typeof text === "string" ? [{ t: text }] : text;
  const out: React.ReactNode[] = [];
  let pos = 0;
  spans.forEach((span, i) => {
    const start = pos;
    const end = start + span.t.length;
    pos = end;
    const cuts = new Set<number>([start, end]);
    for (const [from, to] of hits) {
      if (from > start && from < end) cuts.add(from);
      if (to > start && to < end) cuts.add(to);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const cls = "s" in span ? spanClass(span.s) : "";
    for (let j = 0; j + 1 < sorted.length; j += 1) {
      const a = sorted[j] ?? 0;
      const b = sorted[j + 1] ?? 0;
      if (b <= a) continue;
      const piece = span.t.slice(a - start, b - start);
      const marked = hits.some(([from, to]) => from <= a && b <= to);
      out.push(
        <span key={`${i}:${a}`} className={cls}>
          {marked ? <mark className="tspi-mark">{piece}</mark> : piece}
        </span>,
      );
    }
  });
  return <>{out}</>;
}

/** 纯文本的命中高亮；`offset` 是这段文字在整个标签纯文本里的起点（hits 是整个标签的偏移）。 */
export function MarkedPlain({
  text,
  hits,
  offset = 0,
}: {
  text: string;
  hits?: readonly HitRange[] | undefined;
  offset?: number;
}) {
  if (hits === undefined || hits.length === 0) return <>{text}</>;
  const marked: boolean[] = Array.from({ length: text.length }, (_, i) =>
    hits.some(([from, to]) => from <= offset + i && offset + i < to),
  );
  const out: React.ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marked[i] !== marked[start]) {
      const piece = text.slice(start, i);
      out.push(
        marked[start] ? (
          <mark key={start} className="tspi-mark">
            {piece}
          </mark>
        ) : (
          piece
        ),
      );
      start = i;
    }
  }
  return <>{out}</>;
}
