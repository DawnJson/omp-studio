// 按注册表画一个节点的全部子节点。每个子节点自己按 id 订阅（useTspNode），记录没换就不重画。
import { memo } from "react";
import type { NodeProps, TspContext } from "./node-props.ts";
import { nodeRegistry } from "./registry.ts";
import { TextFallback } from "./nodes/fallback.tsx";
import { useTspNode } from "./tsp-store.ts";

/**
 * omp 自己的输入框卡片（dock 里 role `omp.editor`：编辑器 + 模型 / 思考强度 / 上下文 / 费用 / 发送）不画：
 * 输入框是 studio 的 Composer（features/composer），文字用 `send` 事件交给 omp。不挂载它的 editor 节点，
 * 也就不会有一个看不见的 textarea 抢走键盘焦点。提问 / 审批把卡片换成的 `omp.editor.ask*` 是别的 role，照常画。
 */
const OMP_COMPOSER_ROLE = "omp.editor";
/** omp 自己的欢迎块（logo、"omp"、版本、小提示）不画：过程区顶部是 studio 自己的标题块（TspView 的 StudioHeader）。 */
const OMP_WELCOME_ROLE = "omp.welcome";

export const TspNode = memo(function TspNode({ id, ctx }: { id: string; ctx: TspContext }) {
  const node = useTspNode(ctx.taskId, ctx.sf, id);
  if (node === null) return null;
  const nodeRole = node.p["role"];
  if (nodeRole === OMP_COMPOSER_ROLE || nodeRole === OMP_WELCOME_ROLE) return null;
  const Component = nodeRegistry()[node.k] ?? TextFallback;
  return <Component node={node} ctx={ctx} />;
});

export function TspChildren({ node, ctx }: NodeProps) {
  return (
    <>
      {node.c.map((id) => (
        <TspNode key={id} id={id} ctx={ctx} />
      ))}
    </>
  );
}
