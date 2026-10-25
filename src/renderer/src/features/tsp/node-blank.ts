// 哪些节点不画元素、哪些 col / row 因此没有可显示的内容（渲染时判断，取代原来 tsp.css 里的 `:has()` / `:empty` 规则）。
// 判断只看这个容器的子节点和孙节点的记录（O(子节点数)），不递归整棵树：孙节点只用来判断子 col / row 是不是空的。
import type { DocNode } from "../../../../shared/tsp/document.ts";
import { ASK_BUTTON_ROLE } from "../../../../shared/tsp/ask-gate.ts";
import { ERROR_BANNER_ROLE, isOmpErrorDuplicate } from "../../../../shared/tsp/error-turn.ts";
import { isBtwOverlayNode } from "../../../../shared/tsp/btw.ts";
import { isApprovalDuplicateButton } from "../../../../shared/tsp/gate.ts";
import { TODO_HUD_ROLE } from "../../../../shared/tsp/todos.ts";
import { HIDDEN_HUD_ROLES } from "../../../../shared/tsp/working.ts";

/**
 * omp 自己的输入框卡片（dock 里 role `omp.editor`：编辑器 + 模型 / 思考强度 / 上下文 / 费用 / 发送）不画：
 * 输入框是 studio 的 Composer（features/composer），文字用 `send` 事件交给 omp。不挂载它的 editor 节点，
 * 也就不会有一个看不见的 textarea 抢走键盘焦点。提问 / 审批把卡片换成的 `omp.editor.ask*` 是别的 role，照常画。
 */
const OMP_COMPOSER_ROLE = "omp.editor";
/** omp 自己的欢迎块（logo、"omp"、版本、小提示）不画：过程区顶部是 studio 自己的标题块（TspView 的 StudioHeader）。 */
const OMP_WELCOME_ROLE = "omp.welcome";
/** omp 的空闲回顾行：对话里只画最新的一条（RecapRow）。 */
export const RECAP_ROLE = "omp.recap";
// omp 的 HUD（`omp.hud` 作业 / 子代理胶囊、`omp.hud.activity` 运行状态行 + 待办药丸，HIDDEN_HUD_ROLES）不画：输入框上方是 studio 自己的 ComposerTop（composer/ComposerTop.tsx，药丸 + 状态行 + 待办板），数据同源（shared/tsp/{working,jobs,agent-hub,todos}.ts）。
// omp 错误卡的"Retry F5"和 dock 里的错误横幅（isOmpErrorDuplicate；横幅只在有错误卡时不画）也不画：错误文字以卡片为准，重试只留 studio 的按钮（session-info/RetryButton.tsx）；F5 照常转发。
// omp 的旁路提问弹窗（role omp.overlay.btwHistory，isBtwOverlayNode）也不画：旁路提问是 studio 的 BtwPanel（features/btw），数据同源（shared/tsp/btw.ts）。
// 审批卡底栏的 Deny / Approve 按钮（isApprovalDuplicateButton）不画：和选项列表重复；批准键 Ctrl+Enter 在输入框占位符里说明。

/** 只看记录就知道 studio 不画的节点（TspNode 直接返回 null）。 */
export function neverDrawn(node: DocNode): boolean {
  const role = node.p["role"];
  if (role === OMP_COMPOSER_ROLE || role === OMP_WELCOME_ROLE || role === TODO_HUD_ROLE) return true;
  if (typeof role === "string" && HIDDEN_HUD_ROLES.has(role)) return true;
  return isBtwOverlayNode(node) || isOmpErrorDuplicate(node, false) || isApprovalDuplicateButton(node);
}

/** 画不画还要看对话整体的两个节点：错误横幅（有没有收尾的错误卡）和回顾行（是不是最新的一条）；用到时才读。 */
export interface DrawEnv {
  peek: (id: string) => DocNode | null;
  readonly hasErrorCard: boolean;
  readonly latestRecap: string | undefined;
}

/** 节点的 role 会让"画不画"依赖对话整体（订阅 role 索引才能跟上）。 */
export function dependsOnRoles(node: DocNode | null): boolean {
  const role = node?.p["role"];
  return role === ERROR_BANNER_ROLE || (role === RECAP_ROLE && node?.k === "row");
}

/** 这个节点会不会画出 DOM 元素（对应 TspNode / RecapRow / ErrorBanner 里返回 null 的几处）。 */
function draws(node: DocNode, env: DrawEnv): boolean {
  if (neverDrawn(node)) return false;
  if (node.p["role"] === ERROR_BANNER_ROLE && isOmpErrorDuplicate(node, env.hasErrorCard)) return false;
  if (node.k === "row" && node.p["role"] === RECAP_ROLE && env.latestRecap !== node.id) return false;
  return true;
}

/** 作为 col / row：一个元素都没有（原来的 `:empty`）。 */
function isEmptyContainer(node: DocNode, env: DrawEnv): boolean {
  for (const id of node.c) {
    const child = env.peek(id);
    if (child !== null && draws(child, env)) return false;
  }
  return true;
}

/**
 * 这个子节点能不能撑开父容器：画出了元素、没有 hidden、也不是空的 col（`rowsToo`：空的 row 也不算）。
 * 提问 / 审批的按钮行（ASK_BUTTON_ROLE）画的是 <button>，不是 `.tsp-row`，永远算内容。
 */
function fillsParent(child: DocNode, env: DrawEnv, rowsToo: boolean): boolean {
  if (!draws(child, env) || child.p["hidden"] === true) return false;
  if (child.k === "col") return !isEmptyContainer(child, env);
  if (child.k === "row" && rowsToo && child.p["role"] !== ASK_BUTTON_ROLE) return !isEmptyContainer(child, env);
  return true;
}

/**
 * 子节点里有没有能显示的内容。col / row（`rowsToo` = true）没有就整个收起（不占位也不产生间距，data-blank）；
 * dock 只排除空的 col、空的 row 照常算（`rowsToo` = false）。
 */
export function hasNoVisibleChild(ids: readonly string[], env: DrawEnv, rowsToo: boolean): boolean {
  for (const id of ids) {
    const child = env.peek(id);
    if (child !== null && fillsParent(child, env, rowsToo)) return false;
  }
  return true;
}
