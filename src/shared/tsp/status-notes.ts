// omp 的状态行（`showStatus`：切模型的 "Session-only model: …"、"Session compacted 1 time"、"Fast mode enabled." 等）。
// 终端里它是对话末尾一行暗色文字、一直留着；TSP 里 omp 把它描述成一个 `toast` 节点（role `omp.toast.status`，ttl 2400），
// 加进 `main` 末尾、下一帧就换成隐藏的占位 `col`——节点不留在文档里。想和终端一样留在对话里，只能在它出现的那一帧记下来：
// 文字，加上它前面那个兄弟节点的 id（之后的内容都在这个节点后面追加，状态行就停在它后面）。
// 终端里连着出的状态行只留最后一条：omp 的 `showStatus` 发现对话最后一个就是上一条状态行时，原地改它的文字（`setMessage`），
// TSP 里就是同一个节点 id 换了新的 toast。所以同一个节点 id 的新状态行替换旧的（`mergeStatusNotes`），不往下摞。
// 记在文档里（`DocSurface.statusNotes`，`applyFrame` 调用本文件），主进程和渲染进程各应用同一批消息得到同一份，
// 也就跟着快照走：任务界面晚于 omp 启动才打开时，启动那几条状态行也在。
// 实测（omp 18.12.5，fixtures/tsp/compact.jsonl、picker.jsonl：三条状态行都是节点 `s` / `o` 原地换文字）。纯函数。
import type { DocSurface } from "./document.ts";
import type { TspOp } from "./tsp.generated.ts";

export const STATUS_TOAST_ROLE = "omp.toast.status";

export interface StatusNote {
  text: string;
  /** omp 的 toast 节点 id：同一个 id 的新状态行是 omp 原地换了文字，替换这一条。 */
  id: string;
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
    notes.push({ text, id: node.id, anchor: siblings[index - 1] ?? null });
  }
  return notes;
}

/** 把这一帧新出现的状态行并进已有的：同一个节点 id 的原地替换（omp 改了那一行的文字），其余追加。 */
export function mergeStatusNotes(existing: readonly StatusNote[], added: readonly StatusNote[]): StatusNote[] {
  const out = [...existing];
  for (const note of added) {
    const index = out.findIndex((old) => old.id === note.id);
    if (index >= 0) out[index] = note;
    else out.push(note);
  }
  return out;
}
