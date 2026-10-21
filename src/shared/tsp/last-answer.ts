// "复制最后一条回答"（命令面板 copyLast、Ctrl Shift C）要的文字：从 TSP 文档里取最后一条助手消息的正文。纯函数。
//
// 依据 omp 18.12.5 的实测录制（fixtures/tsp/task.jsonl、resume-session.jsonl）：每条助手消息是 `col role=omp.assistant`，
// 正文是它里面不带 role 的 `md` 节点，`p.text` 是 markdown 原文（如 `**29 passed**`，不是渲染后的文字）；同一容器里工具卡片（`tool`）、
// 思考块（`omp.thinking`）、错误卡（`omp.error`）是别的节点，用量行（`omp.turn.usage`）是 `row`。一轮里有工具调用时会有好几个助手容器，
// 只有没有正文的（纯工具调用）容器跳过，所以"最后一条"= 文档顺序里最后一个有正文的容器。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效（命令返回 null，界面提示没有可复制的回答），所以判断集中在这里。
import type { DocNode, DocSurface, TspDocument } from "./document.ts";

const ASSISTANT_ROLE = "omp.assistant";

/** 助手容器里不算回答正文的子树：工具卡片、子代理、思考块、卡片（错误卡等）。 */
function isSideContent(node: DocNode): boolean {
  const role = node.p["role"];
  return (
    node.k === "tool" ||
    node.k === "agent" ||
    node.k === "card" ||
    (typeof role === "string" && (role === "omp.thinking" || role.startsWith("omp.tool.")))
  );
}

/** 容器里的正文：不带 role 的 `md` 节点的 markdown 原文，按文档顺序用空行连起来；没有为空串。 */
function answerIn(surface: DocSurface, containerId: string): string {
  const parts: string[] = [];
  const walk = (id: string): void => {
    const node = surface.nodes.get(id);
    if (node === undefined) return;
    if (node.k === "md" && node.p["role"] === undefined) {
      const text = node.p["text"];
      if (typeof text === "string" && text.trim() !== "") parts.push(text.trim());
      return;
    }
    if (isSideContent(node)) return;
    for (const child of node.c) walk(child);
  };
  for (const child of surface.nodes.get(containerId)?.c ?? []) walk(child);
  return parts.join("\n\n");
}

/** 最后一个 inline surface（会话本体）里最后一条有正文的助手消息的 markdown 原文；没有回答时为 null。 */
export function lastAnswerText(doc: TspDocument): string | null {
  let session: DocSurface | null = null;
  for (const surface of doc.surfaces.values()) if (surface.mode === "inline") session = surface;
  if (session === null) return null;
  let answer: string | null = null;
  const walk = (id: string): void => {
    const node = session.nodes.get(id);
    if (node === undefined) return;
    if (node.p["role"] === ASSISTANT_ROLE) {
      const text = answerIn(session, id);
      if (text !== "") answer = text;
      return;
    }
    for (const child of node.c) walk(child);
  };
  walk("main");
  return answer;
}
