// 一轮以错误结束时 omp 画的错误卡（`omp.error`）和"该不该给它一个重试按钮"的判断。纯函数。
//
// 依据 omp 18.12.5 的实测录制 fixtures/tsp/error-turn.jsonl（无效 key → 401，test/tsp-error-turn.test.ts 逐帧验证）：
// - 助手消息容器 `col role=omp.assistant` 里有 `card role=omp.error tone=error`：头是 "Request failed" 加 `badge role=omp.error.code`（"401"），
//   正文 `text role=omp.error.message`，底部 `row role=omp.error.actions` 里是 `omp.error.action`：retry（"Retry F5"）、copy-error、switch-model；
//   dock 里另有一行 `omp.errorBanner`（同一段错误文字 + Details / Dismiss），见 isOmpErrorDuplicate；
// - 对话里发 `/retry`（send 事件）：成功时 omp 不发 toast，直接重跑这一轮（实测又失败了一次：旧错误卡 `q.0` 被换掉内容，
//   又追加了新的助手容器 `u` 带新的错误卡）；没有可重试的内容时才有 toast "Nothing to retry"（native-ui-plan §2.1）。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效（收尾错误卡上 studio 的重试按钮会失效、omp 自己的重复节点会重新出现，/retry 仍能用），所以判断集中在这里。
import type { DocNode } from "./document.ts";

export const ERROR_CARD_ROLE = "omp.error";
const ASSISTANT_ROLE = "omp.assistant";
const USER_ROLE = "omp.user";

/**
 * main 区里"收尾的错误卡"的 id：文档顺序里最后一张错误卡，且它之后没有新的用户消息、也没有不带错误的助手消息
 * （那说明重试成功了或用户接着聊了）。没有为 null。`nodes` 是 surface 的节点表，从 `main` 往下走。
 */
export function trailingErrorCardId(nodes: ReadonlyMap<string, DocNode>): string | null {
  let candidate: string | null = null;
  const walk = (id: string): void => {
    const node = nodes.get(id);
    if (node === undefined) return;
    const role = node.p["role"];
    if (role === ERROR_CARD_ROLE) candidate = id;
    else if (role === USER_ROLE) candidate = null;
    const before = candidate;
    for (const child of node.c) walk(child);
    // 一整条助手消息里没出现错误卡：它是正常的回答，之前的错误已经过去了。
    if (role === ASSISTANT_ROLE && candidate === before) candidate = null;
  };
  walk("main");
  return candidate;
}

export const ERROR_BANNER_ROLE = "omp.errorBanner";
const ERROR_ACTION_ROLE = "omp.error.action";
const RETRY_ACTION = "retry";

/**
 * studio 不画的 omp 错误节点（它们和 studio 已有的界面重复）：
 * - dock 里的错误横幅（`row role=omp.errorBanner`，一行错误文字 + Details / Dismiss）：只在对话里有收尾的错误卡（`hasTrailingErrorCard`，同一段错误已在卡片里完整显示）时不画；
 *   没有卡片时横幅是这条错误唯一的显示，照常画（错误不能被吞掉）；
 * - 错误卡里的"Retry F5"（`omp.error.action`，`actions.click = "retry"`）：重试只留 studio 的"重试"按钮（RetryButton）。
 *   键盘 F5 不受影响：输入框里的 F5 由 studio 原样转发给 omp（shared/tsp/forward-keys.ts）。
 * 复制错误、换模型两个动作照常画。
 */
export function isOmpErrorDuplicate(node: Pick<DocNode, "p">, hasTrailingErrorCard: boolean): boolean {
  const role = node.p["role"];
  if (role === ERROR_BANNER_ROLE) return hasTrailingErrorCard;
  if (role !== ERROR_ACTION_ROLE) return false;
  const actions = node.p["actions"];
  return (
    typeof actions === "object" && actions !== null && (actions as Record<string, unknown>)["click"] === RETRY_ACTION
  );
}
