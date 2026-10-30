// `/compact`、`/handoff` 的结局（omp 18.12.5 实录 fixtures/tsp/compact-ok.jsonl、compact-error.jsonl；`/handoff` 18.12.6 实测见 docs/architecture/context-compaction.md）：
// - 没有 toast。压缩期间 dock 里的 `omp.working` 行显示 "Compacting context…"。
// - 成功：main 里新增一个 `section role=omp.compaction`（头文字 "Soft-compacted · 12K → 9.1K tokens"；交接是 "Handed-off · …"）。
// - 失败：main 里新增一个错误行（error-lines.ts）："Error: Compaction failed: Nothing to compact (session too small)" /
//   "Error: Handoff failed: Nothing to hand off (already compacted)"；omp 18.14.0 的错误行不带 "Error: "
//   （"Compaction failed: …"，fixtures/tsp/switch-compact-error.jsonl）。
import type { TspDocument } from "./document.ts";
import { errorLines } from "./error-lines.ts";

/** 发 `/compact` 之前文档里已经有的压缩分隔和错误文字（按节点 id），之后只看新增的。 */
export interface CompactionMark {
  sections: ReadonlySet<string>;
  errors: ReadonlySet<string>;
}

export type CompactionOutcome = { ok: true } | { ok: false; error: string };

const FAILURE = /^(?:Error: )?(?:Compaction|Handoff) failed/;

function scan(doc: TspDocument): { sections: Set<string>; errors: Map<string, string> } {
  const sections = new Set<string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k === "section" && node.p["role"] === "omp.compaction") sections.add(`${sf}/${node.id}`);
    }
  }
  const errors = new Map([...errorLines(doc)].filter(([, text]) => FAILURE.test(text)));
  return { sections, errors };
}

export function compactionMark(doc: TspDocument): CompactionMark {
  const { sections, errors } = scan(doc);
  return { sections, errors: new Set(errors.keys()) };
}

/** 比较当前文档和发命令前的标记：出现新的压缩分隔 = 成功，新的 "[Error: ]Compaction failed…" = 失败，都没有 = null（还在压缩）。 */
export function compactionOutcome(doc: TspDocument, before: CompactionMark): CompactionOutcome | null {
  const now = scan(doc);
  for (const [id, text] of now.errors) if (!before.errors.has(id)) return { ok: false, error: text };
  for (const id of now.sections) if (!before.sections.has(id)) return { ok: true };
  return null;
}
