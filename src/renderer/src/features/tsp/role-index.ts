// main 区里按 role 找节点（用量行的位置、用户消息有没有、最新回顾行、收尾错误卡）：tsp-store 按 (任务, surface) 缓存，
// 只在 ROLE_INDEX_NODES 声明的节点变了时重建（NodeWatch），纯文字流式输出不重建。纯函数，单测直接比对。
import type { DocNode } from "../../../../shared/tsp/document.ts";
import { ERROR_CARD_ROLE, trailingErrorCardId } from "../../../../shared/tsp/error-turn.ts";
import type { NodeDeps } from "../../../../shared/tsp/node-watch.ts";
import { RECAP_ROLE } from "./node-blank.ts";

/** omp 每轮末尾的用量行。 */
const USAGE_ROLE = "omp.turn.usage";
export const USER_ROLE = "omp.user";
/** omp 每条助手消息的容器；每轮最后一个是用量行的父节点。 */
const ASSISTANT_ROLE = "omp.assistant";
const INDEXED_ROLES: readonly string[] = [USAGE_ROLE, USER_ROLE, ASSISTANT_ROLE, RECAP_ROLE];

/** buildRoleIndex 读的节点：索引里的 role，加上 trailingErrorCardId 看的错误卡。 */
export const ROLE_INDEX_NODES: NodeDeps = { roles: [...INDEXED_ROLES, ERROR_CARD_ROLE] };

export interface RoleIndex {
  /** INDEXED_ROLES 的节点 id，文档顺序。 */
  byRole: Map<string, string[]>;
  /** 轮数（轮 = 一个 omp.user 到下一个）。 */
  turnCount: number;
  /** 没有用量行的轮的最后一个助手节点 id → 这一轮是第几轮（从 0 数）。 */
  lastAssistantOfBareTurn: Map<string, number>;
  /** 对话末尾的错误卡（见 trailingErrorCardId）；没有为 null。 */
  trailingError: string | null;
}

export function buildRoleIndex(nodes: ReadonlyMap<string, DocNode> | undefined): RoleIndex {
  const byRole = new Map<string, string[]>(INDEXED_ROLES.map((r) => [r, []]));
  /** 按文档顺序切轮：第一个 omp.user 之前的内容不算轮。 */
  const turns: { lastAssistant: string | null; hasUsage: boolean }[] = [];
  const walk = (id: string): void => {
    const node = nodes?.get(id);
    if (!node) return;
    const nodeRole = node.p["role"];
    if (typeof nodeRole === "string") {
      byRole.get(nodeRole)?.push(id);
      const turn = turns[turns.length - 1];
      if (nodeRole === USER_ROLE) turns.push({ lastAssistant: null, hasUsage: false });
      else if (turn && nodeRole === ASSISTANT_ROLE) turn.lastAssistant = id;
      else if (turn && nodeRole === USAGE_ROLE) turn.hasUsage = true;
    }
    for (const child of node.c) walk(child);
  };
  walk("main");
  const lastAssistantOfBareTurn = new Map<string, number>();
  turns.forEach((turn, index) => {
    if (turn.lastAssistant === null || turn.hasUsage) return;
    lastAssistantOfBareTurn.set(turn.lastAssistant, index);
  });
  return {
    byRole,
    turnCount: turns.length,
    lastAssistantOfBareTurn,
    trailingError: nodes === undefined ? null : trailingErrorCardId(nodes),
  };
}
