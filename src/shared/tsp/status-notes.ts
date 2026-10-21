// omp 的状态行（`showStatus`：切模型的 "Session-only model: …"、"Session compacted 1 time"、"Fast mode enabled." 等）。
// 终端里它是对话末尾一行暗色文字、一直留着；TSP 里 omp 把它描述成一个 `toast` 节点（role `omp.toast.status`，ttl 2400），
// 加进 `main` 末尾、下一帧就换成隐藏的占位 `col`——节点不留在文档里。想和终端一样留在对话里，只能在它出现的那一帧记下来：
// 文字，加上它前面那个兄弟节点的 id（之后的内容都在这个节点后面追加，状态行就停在它后面）。
// 记在文档里（`DocSurface.statusNotes`，`applyFrame` 调用本文件），主进程和渲染进程各应用同一批消息得到同一份，
// 也就跟着快照走：任务界面晚于 omp 启动才打开时，启动那几条状态行也在。
// 实测（omp 18.12.5，fixtures/tsp/compact.jsonl、picker.jsonl）。纯函数。
import type { DocSurface } from "./document.ts";
import type { TspOp } from "./tsp.generated.ts";

export const STATUS_TOAST_ROLE = "omp.toast.status";

export interface StatusNote {
  text: string;
  /** 它出现时 main 里排在它前面的节点 id；它是第一个子节点时为 null。 */
  anchor: string | null;
}

/** 刚应用完的这一帧里新出现的状态行（按帧里 add 的顺序）。要在 ops 都应用之后调用。 */
export function statusNotesIn(surface: DocSurface, ops: readonly TspOp[]): StatusNote[] {
  const notes: StatusNote[] = [];
  for (const op of ops) {
    if (op[0] !== "add" || op[2] !== "main" || op[4].k !== "toast") continue;
    const node = surface.nodes.get(op[1]);
    const text = node?.p["text"];
    if (node?.p["role"] !== STATUS_TOAST_ROLE || typeof text !== "string" || text.trim() === "") continue;
    const siblings = surface.nodes.get("main")?.c ?? [];
    const index = siblings.indexOf(node.id);
    if (index < 0) continue;
    notes.push({ text, anchor: siblings[index - 1] ?? null });
  }
  return notes;
}
