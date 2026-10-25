// 按注册表画一个节点的全部子节点。每个子节点自己按 id 订阅（useTspNode），记录没换就不重画。
import { memo, type ComponentType } from "react";
import type { NodeProps, TspContext } from "./node-props.ts";
import { nodeRegistry } from "./registry.ts";
import { TextFallback } from "./nodes/fallback.tsx";
import { useHasTrailingErrorCard, useTspNode } from "./tsp-store.ts";
import { neverDrawn } from "./node-blank.ts";
import { ERROR_BANNER_ROLE, isOmpErrorDuplicate } from "../../../../shared/tsp/error-turn.ts";

// 哪些节点不画（omp 自己的输入框 / 欢迎块 / HUD / 重复的错误节点 / 旁路提问弹窗 / 审批重复按钮）见 node-blank.ts 的 neverDrawn，
// 父容器据此判断自己有没有可显示的子节点（data-blank）。

export const TspNode = memo(function TspNode({ id, ctx }: { id: string; ctx: TspContext }) {
  const node = useTspNode(ctx.taskId, ctx.sf, id);
  if (node === null || neverDrawn(node)) return null;
  const nodeRole = node.p["role"];
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
