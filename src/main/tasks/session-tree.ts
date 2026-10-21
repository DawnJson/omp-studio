// 会话树的原始节点 → 会话树面板用的节点列表（纯函数）。
// omp 的树节点是 `{ entry, children }`，entry 是会话文件里的一行（model_change、message、compaction…）；
// 面板只关心用户消息：它们是 `branch` 能去的地方，也是 TUI 里 /tree 默认显示的节点。
import type { SessionTreeNode } from "../../shared/ipc.ts";

const MAX_TEXT_CHARS = 200;

interface RawNode {
  entry: Record<string, unknown>;
  children: RawNode[];
}

interface UserNode {
  entryId: string;
  text: string;
  parent: number;
  children: number[];
}

function isRawNode(value: unknown): value is RawNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "entry" in value &&
    typeof value.entry === "object" &&
    value.entry !== null &&
    "children" in value &&
    Array.isArray(value.children)
  );
}

/** 用户（不是 omp 自己注入的 attribution=agent）消息条目 → 第一行文字；不是用户消息返回 null。 */
export function userEntryText(entry: Record<string, unknown>): string | null {
  if (entry["type"] !== "message") return null;
  const message = entry["message"];
  if (typeof message !== "object" || message === null) return null;
  const fields = message as Record<string, unknown>;
  if (fields["role"] !== "user" || fields["attribution"] === "agent") return null;
  const content = fields["content"];
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((block: unknown) =>
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>)["type"] === "text" &&
              typeof (block as Record<string, unknown>)["text"] === "string"
                ? [(block as Record<string, string>)["text"] as string]
                : [],
            )
            .join("\n")
        : "";
  const firstLine = raw.split("\n").find((line) => line.trim() !== "") ?? "";
  const line = firstLine.trim();
  return line.length > MAX_TEXT_CHARS ? `${line.slice(0, MAX_TEXT_CHARS)}…` : line;
}

/**
 * 先序（兄弟按会话文件里的先后）展开用户消息。缩进只在"父用户消息有不止一个用户消息分支"时加一级，
 * 一条直线的对话全部在第 0 级。显式栈：长会话的树很深，递归会爆栈。
 */
export function buildSessionTree(tree: readonly unknown[], leafId: string | null): SessionTreeNode[] {
  const parentOf = new Map<string, string | null>();
  const users: UserNode[] = [];

  const stack: { node: RawNode; userParent: number }[] = [];
  for (let i = tree.length - 1; i >= 0; i--) {
    const root = tree[i];
    if (isRawNode(root)) stack.push({ node: root, userParent: -1 });
  }
  while (stack.length > 0) {
    const { node, userParent } = stack.pop() as { node: RawNode; userParent: number };
    const id = node.entry["id"];
    const parentId = node.entry["parentId"];
    if (typeof id === "string") parentOf.set(id, typeof parentId === "string" ? parentId : null);
    let nextParent = userParent;
    const text = typeof id === "string" ? userEntryText(node.entry) : null;
    if (typeof id === "string" && text !== null) {
      const index = users.length;
      users.push({ entryId: id, text, parent: userParent, children: [] });
      if (userParent >= 0) (users[userParent] as UserNode).children.push(index);
      nextParent = index;
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (isRawNode(child)) stack.push({ node: child, userParent: nextParent });
    }
  }

  const onBranch = new Set<string>();
  for (let id = leafId; id !== null && !onBranch.has(id); id = parentOf.get(id) ?? null) onBranch.add(id);

  const indents: number[] = [];
  return users.map((user, index) => {
    const parent = user.parent >= 0 ? (users[user.parent] as UserNode) : null;
    const indent = parent === null ? 0 : (indents[user.parent] as number) + (parent.children.length > 1 ? 1 : 0);
    indents[index] = indent;
    const here = onBranch.has(user.entryId);
    return {
      entryId: user.entryId,
      text: user.text,
      indent,
      onCurrentBranch: here,
      current: here && !user.children.some((child) => onBranch.has((users[child] as UserNode).entryId)),
    };
  });
}
