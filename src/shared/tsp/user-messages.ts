// 会话里发过的用户消息：从 TSP 文档里按顺序取（输入框 ↑↓ 翻历史要原文，过程区右侧的对话线要节点 id）。纯函数。
//
// 依据 omp 18.12.5 的实测录制（fixtures/tsp/task.jsonl）：每条用户消息是 main 里的 `card role=omp.user`，
// 子节点是工具行（`row role=omp.user.tools`：复制、回退、时间）和正文 `md`（`p.text` 是发出去的原文）。
// 恢复的会话、草稿页发出的第一句、别处（终端版）发的消息都在里面；omp 只画压缩点之后的消息，更早的翻不到。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名后这里取不到（只剩 studio 内存里记的），所以判断集中在这里。
import type { DocSurface, TspDocument } from "./document.ts";
import type { NodeDeps } from "./node-watch.ts";

const USER_ROLE = "omp.user";

/** userMessages 读的节点（NodeWatch）：用户消息卡片和它下面的正文。 */
export const USER_MESSAGE_NODES: NodeDeps = { roles: [USER_ROLE], children: true };

export interface UserMessage {
  /** omp.user 卡片的节点 id（页面里是 `[data-id]`）。 */
  id: string;
  text: string;
}

function userText(surface: DocSurface, cardId: string): string {
  const parts: string[] = [];
  for (const id of surface.nodes.get(cardId)?.c ?? []) {
    const node = surface.nodes.get(id);
    if (node?.k !== "md") continue;
    const text = node.p["text"];
    if (typeof text === "string" && text.trim() !== "") parts.push(text.trim());
  }
  return parts.join("\n\n");
}

/** 最后一个 inline surface（会话本体）里的用户消息，文档顺序；没有文档或没有消息时为空数组。 */
export function userMessages(doc: TspDocument | null): UserMessage[] {
  if (doc === null) return [];
  let session: DocSurface | null = null;
  for (const surface of doc.surfaces.values()) if (surface.mode === "inline") session = surface;
  if (session === null) return [];
  const messages: UserMessage[] = [];
  const walk = (id: string): void => {
    const node = session.nodes.get(id);
    if (node === undefined) return;
    if (node.p["role"] === USER_ROLE) {
      const text = userText(session, id);
      if (text !== "") messages.push({ id, text });
      return;
    }
    for (const child of node.c) walk(child);
  };
  walk("main");
  return messages;
}

/** 用户消息的原文（输入框翻历史）。 */
export function userMessageTexts(doc: TspDocument | null): string[] {
  return userMessages(doc).map((message) => message.text);
}

export function sameUserMessages(a: readonly UserMessage[], b: readonly UserMessage[]): boolean {
  return a.length === b.length && a.every((message, i) => message.id === b[i]!.id && message.text === b[i]!.text);
}

/**
 * 对话大纲里一条消息的标题：第一行非空文字（跳过代码围栏行），去掉 Markdown 标记（标题 #、引用 >、列表符号、
 * 强调 * _ ~、行内代码 `、链接和图片只留文字），空白折成一个空格。没有文字时为空串。
 */
export function outlineLabel(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || /^(`{3,}|~{3,})/.test(line)) continue;
    const plain = line
      .replace(/^(>\s*)+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (plain !== "") return plain;
  }
  return "";
}
