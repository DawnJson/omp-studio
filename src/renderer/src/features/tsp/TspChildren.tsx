// 按注册表画一个节点的全部子节点。每个子节点自己按 id 订阅（useTspNode），记录没换就不重画。
import { memo, type ComponentType } from "react";
import type { NodeProps, TspContext } from "./node-props.ts";
import { nodeRegistry } from "./registry.ts";
import { TextFallback } from "./nodes/fallback.tsx";
import { useHasTrailingErrorCard, useTspNode } from "./tsp-store.ts";
import { TODO_HUD_ROLE } from "../../../../shared/tsp/todos.ts";
import { ERROR_BANNER_ROLE, isOmpErrorDuplicate } from "../../../../shared/tsp/error-turn.ts";
import { isBtwOverlayNode } from "../../../../shared/tsp/btw.ts";
import { HIDDEN_HUD_ROLES } from "../../../../shared/tsp/working.ts";

/**
 * omp 自己的输入框卡片（dock 里 role `omp.editor`：编辑器 + 模型 / 思考强度 / 上下文 / 费用 / 发送）不画：
 * 输入框是 studio 的 Composer（features/composer），文字用 `send` 事件交给 omp。不挂载它的 editor 节点，
 * 也就不会有一个看不见的 textarea 抢走键盘焦点。提问 / 审批把卡片换成的 `omp.editor.ask*` 是别的 role，照常画。
 */
const OMP_COMPOSER_ROLE = "omp.editor";
/** omp 自己的欢迎块（logo、"omp"、版本、小提示）不画：过程区顶部是 studio 自己的标题块（TspView 的 StudioHeader）。 */
const OMP_WELCOME_ROLE = "omp.welcome";
// omp 的 HUD（`omp.hud` 作业 / 子代理胶囊、`omp.hud.activity` 运行状态行 + 待办药丸，HIDDEN_HUD_ROLES）不画：输入框上方是 studio 自己的 ComposerTop（composer/ComposerTop.tsx，药丸 + 状态行 + 待办板），数据同源（shared/tsp/{working,jobs,agent-hub,todos}.ts）。
// omp 错误卡的"Retry F5"和 dock 里的错误横幅（isOmpErrorDuplicate；横幅只在有错误卡时不画）也不画：错误文字以卡片为准，重试只留 studio 的按钮（session-info/RetryButton.tsx）；F5 照常转发。
// omp 的旁路提问弹窗（role omp.overlay.btwHistory，isBtwOverlayNode）也不画：旁路提问是 studio 的 BtwPanel（features/btw），数据同源（shared/tsp/btw.ts）。

export const TspNode = memo(function TspNode({ id, ctx }: { id: string; ctx: TspContext }) {
  const node = useTspNode(ctx.taskId, ctx.sf, id);
  if (node === null) return null;
  const nodeRole = node.p["role"];
  if (nodeRole === OMP_COMPOSER_ROLE || nodeRole === OMP_WELCOME_ROLE || nodeRole === TODO_HUD_ROLE) return null;
  if (typeof nodeRole === "string" && HIDDEN_HUD_ROLES.has(nodeRole)) return null;
  if (isBtwOverlayNode(node) || isOmpErrorDuplicate(node, false)) return null;
  const Component = nodeRegistry()[node.k] ?? TextFallback;
  // 错误横幅只在有错误卡时才不画：只有它订阅"有没有错误卡"，别的节点不多订阅。
  if (nodeRole === ERROR_BANNER_ROLE) return <ErrorBanner Component={Component} node={node} ctx={ctx} />;
  return <Component node={node} ctx={ctx} />;
});

function ErrorBanner({ Component, node, ctx }: NodeProps & { Component: ComponentType<NodeProps> }) {
  const hasErrorCard = useHasTrailingErrorCard(ctx.taskId, ctx.sf);
  return isOmpErrorDuplicate(node, hasErrorCard) ? null : <Component node={node} ctx={ctx} />;
}

export function TspChildren({ node, ctx }: NodeProps) {
  return (
    <>
      {node.c.map((id) => (
        <TspNode key={id} id={id} ctx={ctx} />
      ))}
    </>
  );
}
