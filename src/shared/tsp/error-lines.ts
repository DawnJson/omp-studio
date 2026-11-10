// omp 往对话里写的一行错误（斜杠命令失败、压缩失败等，omp 的 `showError`），两种写法：
// - omp 18.12.x：main 里新增一个 `text` 节点，span 样式含 `error`，文字以 `Error: ` 开头，没有 role。
//   `/compact` 会话太小：`Error: Compaction failed: Nothing to compact (session too small)`（fixtures/tsp/compact-error.jsonl）；
//   `/handoff`：`Error: Handoff failed: Nothing to hand off (already compacted)`；
//   `/todo start zzz`：`Error: No task matched "zzz". Use /todo to list current tasks.`，`/todo start`：`Error: Usage: /todo start <task>`，
//   `/todo bogus`：`Error: Unknown /todo verb "bogus".` 后面接用法清单（多行，同一个 span）。
// - omp 18.14.0：main 里新增一个 `row role=omp.notice.error`（一个 error 图标 + 一个 `text`），文字不带 `Error: `，
//   如 `Compaction failed: Turn prefix summarization failed: 400 …`（fixtures/tsp/switch-compact-error.jsonl）。
// 警告行同样是一个 row，role 是 `omp.notice.warning`：vibe 模式下发 `/delete` 是 `Exit vibe mode first.`（omp 18.18.6 实测）。
// 命令发出前后比较节点 id（omp 的节点 id 只增不复用）就能认出"这条命令新写出来的错误"。
import { nodeRole, plainText, type DocNode, type TspDocument } from "./document.ts";

const NOTICE_ERROR_ROLE = "omp.notice.error";
const NOTICE_WARNING_ROLE = "omp.notice.warning";

/** `row role=omp.notice.*` 的文字：它下面各个 `text` 子节点连起来。 */
function noticeText(doc: TspDocument, sf: string, node: DocNode): string {
  const surface = doc.surfaces.get(sf);
  return node.c
    .map((id) => surface?.nodes.get(id))
    .map((child) => (child?.k === "text" ? plainText(child) : ""))
    .join("");
}

/** 文档里所有 omp 错误行：`<surface>/<节点 id>` → 文字。 */
export function errorLines(doc: TspDocument): Map<string, string> {
  const lines = new Map<string, string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k === "row" && nodeRole(node) === NOTICE_ERROR_ROLE) {
        const text = noticeText(doc, sf, node);
        if (text !== "") lines.set(`${sf}/${node.id}`, text);
        continue;
      }
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

/** 文档里所有 omp 警告行（`row role=omp.notice.warning`）：`<surface>/<节点 id>` → 文字。 */
export function warningLines(doc: TspDocument): Map<string, string> {
  const lines = new Map<string, string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k !== "row" || nodeRole(node) !== NOTICE_WARNING_ROLE) continue;
      const text = noticeText(doc, sf, node);
      if (text !== "") lines.set(`${sf}/${node.id}`, text);
    }
  }
  return lines;
}

/** `before`（发命令前的 `errorLines`）里没有的第一条错误文字；没有为 null。 */
export function newErrorLine(doc: TspDocument, before: ReadonlyMap<string, string>): string | null {
  for (const [key, text] of errorLines(doc)) if (!before.has(key)) return text;
  return null;
}
