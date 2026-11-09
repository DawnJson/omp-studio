// omp 的状态行（`showStatus`：切模型的 "Session-only model: …"、"Session compacted 1 time"、"Fast mode enabled."、
// Ctrl+O 的 "Tool output expansion: …"、Ctrl+T 的 "Thinking blocks: …" 等）。
// 终端里它是对话末尾一行暗色文字、一直留着；TSP 里 omp 把它描述成一个 `toast` 节点（role `omp.toast.status`，ttl 2400），
// 加进 `main` 末尾。omp 18.12.5 下一帧就把它换成隐藏的占位 `col`——节点不留在文档里，只能在它出现的那一帧记下来：
// 文字，加上它前面那个兄弟节点的 id（之后的内容都在这个节点后面追加，状态行就停在它后面）。
// 终端里连着出的状态行只留最后一条：omp 的 `showStatus` 发现对话最后一个就是上一条状态行时，原地改它的文字（`setMessage`）。
// TSP 里有两种：18.12.5 是同一个节点 id 换了新的 toast；18.12.6 起（todo-commands.jsonl）和 18.18.1 是 toast 节点
// 留在 main，新文字用 `set <id> {text}` 发。两种都按节点 id 替换旧的那条（`mergeStatusNotes`），不往下摞；`set` 沿用已记下的锚点。
// 记在文档里（`DocSurface.statusNotes`，`applyFrame` 调用本文件），主进程和渲染进程各应用同一批消息得到同一份，
// 也就跟着快照走：任务界面晚于 omp 启动才打开时，启动那几条状态行也在。
// 实测：omp 18.12.5（fixtures/tsp/compact.jsonl、picker.jsonl：三条状态行都是节点 `s` / `o` 原地换文字）；
// 18.12.6（todo-commands.jsonl）、18.18.1（Ctrl+O / Ctrl+T 连按：`add w main {k:"toast"}` 之后每次是 `set w {text}`）。纯函数。
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

/** 刚应用完的这一帧里新出现或改了文字的状态行（按帧里 op 的顺序）。要在 ops 都应用之后调用。 */
export function statusNotesIn(surface: DocSurface, ops: readonly TspOp[]): StatusNote[] {
  const notes: StatusNote[] = [];
  for (const op of ops) {
    if (op[0] !== "add" && op[0] !== "set") continue;
    const node = surface.nodes.get(op[1]);
    if (node?.k !== "toast" || node.parent !== "main") continue;
    const text = node.p["text"];
    if (node.p["role"] !== STATUS_TOAST_ROLE || typeof text !== "string" || text.trim() === "") continue;
    const known = op[0] === "set" ? surface.statusNotes.find((note) => note.id === node.id) : undefined;
    if (known) {
      // ttl 之类没改文字的 set 不动这一条（statusNotes 保持同一个数组）。
      if (known.text !== text) notes.push({ text, id: node.id, anchor: known.anchor });
      continue;
    }
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

const TOOL_EXPANSION = /^Tool output expansion: (enabled|disabled)\b/;

/**
 * 这一帧的状态行里 omp 报的工具输出展开状态（Ctrl+O 的 "Tool output expansion: enabled / disabled"，omp 18.18.1 实测）；没有这一行为 null。
 * 要在出现那一帧读：18.18 里同一个 toast 节点之后会被 Ctrl+T 的 "Thinking blocks: …" 换掉文字。
 */
export function toolExpansionIn(added: readonly StatusNote[]): boolean | null {
  let expanded: boolean | null = null;
  for (const note of added) {
    const match = TOOL_EXPANSION.exec(note.text);
    if (match) expanded = match[1] === "enabled";
  }
  return expanded;
}
