// 会话树面板打开时光标放哪：从对话里的"回退"图标进来时，对准那条用户消息（倒数第几张卡片 = 当前分支上倒数第几条用户消息）。
import type { SessionTreeNode } from "../../../../shared/ipc.ts";

/** 当前分支上倒数第 `fromEnd` 条用户消息（0 = 最后一条）在 `nodes` 里的下标；超出范围返回 null。 */
export function focusIndexFromEnd(nodes: readonly SessionTreeNode[], fromEnd: number): number | null {
  const onBranch: number[] = [];
  for (const [index, node] of nodes.entries()) if (node.kind === "user" && node.onCurrentBranch) onBranch.push(index);
  return onBranch[onBranch.length - 1 - fromEnd] ?? null;
}
