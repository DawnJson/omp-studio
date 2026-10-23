// omp 往对话里写的一行错误文字（斜杠命令失败时）：main 里新增一个 `text` 节点，span 样式含 `error`，文字以 `Error: ` 开头。
// 没有 toast、没有节点 role。实测 omp 18.12.5 / 18.12.6：
// - `/compact` 会话太小：`Error: Compaction failed: Nothing to compact (session too small)`（fixtures/tsp/compact-error.jsonl）；
// - `/handoff`：`Error: Handoff failed: Nothing to hand off (already compacted)`；
// - `/todo start zzz`：`Error: No task matched "zzz". Use /todo to list current tasks.`，`/todo start`：`Error: Usage: /todo start <task>`，
//   `/todo bogus`：`Error: Unknown /todo verb "bogus".` 后面接用法清单（多行，同一个 span）。
// 命令发出前后比较节点 id（omp 的节点 id 只增不复用）就能认出"这条命令新写出来的错误"。
import type { TspDocument } from "./document.ts";

/** 文档里所有 omp 错误行：`<surface>/<节点 id>` → 文字。 */
export function errorLines(doc: TspDocument): Map<string, string> {
  const lines = new Map<string, string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k !== "text") continue;
      const spans = node.p["spans"];
      if (!Array.isArray(spans)) continue;
      const text = spans.map((span: { t?: unknown }) => (typeof span.t === "string" ? span.t : "")).join("");
      const isError = spans.some(
        (span: { s?: unknown }) => typeof span.s === "string" && span.s.split(" ").includes("error"),
      );
      if (isError && text.startsWith("Error: ")) lines.set(`${sf}/${node.id}`, text);
    }
  }
  return lines;
}

/** `before`（发命令前的 `errorLines`）里没有的第一条错误文字；没有为 null。 */
export function newErrorLine(doc: TspDocument, before: ReadonlyMap<string, string>): string | null {
  for (const [key, text] of errorLines(doc)) if (!before.has(key)) return text;
  return null;
}
