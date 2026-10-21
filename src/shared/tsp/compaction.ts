// `/compact` 的结局（omp 18.12.5 实录 fixtures/tsp/compact-ok.jsonl、compact-error.jsonl）：
// - 没有 toast。压缩期间 dock 里的 `omp.working` 行显示 "Compacting context…"。
// - 成功：main 里新增一个 `section role=omp.compaction`（头文字 "Soft-compacted · 12K → 9.1K tokens"）。
// - 失败（会话太小）：main 里新增一个 `text`，span 的样式是 `error`，文字 "Error: Compaction failed: Nothing to compact (session too small)"。
import type { TspDocument } from "./document.ts";

/** 发 `/compact` 之前文档里已经有的压缩分隔和错误文字（按节点 id），之后只看新增的。 */
export interface CompactionMark {
  sections: ReadonlySet<string>;
  errors: ReadonlySet<string>;
}

export type CompactionOutcome = { ok: true } | { ok: false; error: string };

function scan(doc: TspDocument): { sections: Set<string>; errors: Map<string, string> } {
  const sections = new Set<string>();
  const errors = new Map<string, string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k === "section" && node.p["role"] === "omp.compaction") sections.add(`${sf}/${node.id}`);
      if (node.k !== "text") continue;
      const spans = node.p["spans"];
      if (!Array.isArray(spans)) continue;
      const text = spans.map((span: { t?: unknown }) => (typeof span.t === "string" ? span.t : "")).join("");
      const isError = spans.some(
        (span: { s?: unknown }) => typeof span.s === "string" && span.s.split(" ").includes("error"),
      );
      if (isError && text.startsWith("Error: Compaction failed")) errors.set(`${sf}/${node.id}`, text);
    }
  }
  return { sections, errors };
}

export function compactionMark(doc: TspDocument): CompactionMark {
  const { sections, errors } = scan(doc);
  return { sections, errors: new Set(errors.keys()) };
}

/** 比较当前文档和发命令前的标记：出现新的压缩分隔 = 成功，新的 "Error: Compaction failed…" = 失败，都没有 = null（还在压缩）。 */
export function compactionOutcome(doc: TspDocument, before: CompactionMark): CompactionOutcome | null {
  const now = scan(doc);
  for (const [id, text] of now.errors) if (!before.errors.has(id)) return { ok: false, error: text };
  for (const id of now.sections) if (!before.sections.has(id)) return { ok: true };
  return null;
}
