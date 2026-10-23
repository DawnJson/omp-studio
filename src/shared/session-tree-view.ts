// 会话树面板的纯逻辑：回溯会丢掉几轮、按文字搜索。主进程不用它，放 shared 是为了单测直接 import（渲染进程文件要进 tsconfig.node.json 才能被测）。
import type { SessionTreeNode } from "./ipc.ts";

/**
 * 回到 `entryId` 这条用户消息之前（omp 把叶子移到它的父节点）时，当前对话里有几轮用户消息会离开对话：
 * 当前分支上、不在"目标的祖先链"里的用户消息——目标在当前分支上就是它和它之后的，目标在别的分支上就是当前分支里
 * 公共祖先之后的。离开的消息仍留在会话文件里（成为另一条分支，`/tree` 里还能回去），所以是"离开"不是删除。
 * 目标不是用户消息、不在列表里：0。
 */
export function discardedTurns(nodes: readonly SessionTreeNode[], entryId: string): number {
  const byId = new Map(nodes.map((node) => [node.entryId, node]));
  const target = byId.get(entryId);
  if (target === undefined || target.kind !== "user") return 0;
  const kept = new Set<string>();
  for (let parent = target.parent; parent !== null && !kept.has(parent); parent = byId.get(parent)?.parent ?? null)
    kept.add(parent);
  return nodes.filter((node) => node.kind === "user" && node.onCurrentBranch && !kept.has(node.entryId)).length;
}

/** 节点能搜的文字：消息文字、标签；压缩点没有文字，只靠标签搜。 */
function searchable(node: SessionTreeNode): string {
  return `${node.text}\n${node.label ?? ""}`.toLowerCase();
}

/**
 * 按文字过滤节点（面板顶部的搜索框）：空白分词、全部词都要出现（不分大小写），匹配消息文字或标签。
 * 空查询原样返回。返回新数组，节点对象不变（缩进、当前标记照旧）。
 */
export function filterTreeNodes(nodes: readonly SessionTreeNode[], query: string): SessionTreeNode[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return [...nodes];
  return nodes.filter((node) => {
    const haystack = searchable(node);
    return words.every((word) => haystack.includes(word));
  });
}
