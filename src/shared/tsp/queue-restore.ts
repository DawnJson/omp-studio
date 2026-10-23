// 运行中排队的消息（Ctrl+Enter / `/queue` / 本轮没结束时发的 send）：纯函数，读 TSP 文档。
// 依据是 omp 18.12.5 的实录 `fixtures/tsp/queue-esc.jsonl`（test/tsp-queue-restore.test.ts 逐帧验证）：
// - 排队的消息在 dock 里的 `omp.queue`（col）下，每条一个 `omp.queue.item` 行（title `Steering`，文字在它的 `text` 子节点）。
// - Esc 中断本轮的那一帧，omp 把队列删掉（`del v`、`del j.bar/stop`），同一帧把排队的文字**追加进它自己的输入框**
//   （`["text","j.line/input","append","<文字>"]`）；这段文字怎么回到 studio 的输入框见 `editor-prefill.ts`（通用规则）。
import { findNode, nodeRole, type TspDocument } from "./document.ts";

const QUEUE_ITEM_ROLE = "omp.queue.item";

/** omp 的排队区里现在有没有等着发的消息：没有就不必在 Esc 之后等输入框被写回。 */
export function hasQueuedMessages(doc: TspDocument): boolean {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    if (findNode(surface, (node) => nodeRole(node) === QUEUE_ITEM_ROLE, "dock")) return true;
  }
  return false;
}
