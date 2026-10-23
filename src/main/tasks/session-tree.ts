// 会话树的原始节点 → 会话树面板用的节点列表（纯函数）。
// omp 的树节点是 `{ entry, children }`，entry 是会话文件里的一行（model_change、message、compaction…）；
// 面板列用户消息（`branch` 能去的地方，也是 TUI 里 /tree 默认显示的节点）、压缩点和分支摘要（分隔 / 摘要节点），并把 label 条目打在节点上。
import type { SessionTreeNode, SessionTreeNodeKind } from "../../shared/ipc.ts";

const MAX_TEXT_CHARS = 200;

interface RawNode {
  entry: Record<string, unknown>;
  children: RawNode[];
}

interface ListedNode {
  entryId: string;
  kind: SessionTreeNodeKind;
  text: string;
  tokensBefore?: number;
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

/** 摘要预览：去掉 omp 固定的开头（"User explored another conversation branch…" / "Exploration summary:"）、Markdown 标题和列表符号，取第一句有内容的话。 */
export function summaryPreview(summary: string): string {
  const body = summary
    .replace(/^\s*User explored another conversation branch, then returned here\.\s*/, "")
    .replace(/^\s*Exploration summary:\s*/, "");
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const content = lines.find((line) => !line.startsWith("#")) ?? lines[0] ?? "";
  const line = content.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+(\[[ x]\]\s+)?/, "");
  return line.length > MAX_TEXT_CHARS ? `${line.slice(0, MAX_TEXT_CHARS)}…` : line;
}

/** 条目 → 面板里的节点种类和文字；不显示的条目（助手消息、model_change、label…）返回 null。 */
function displayOf(entry: Record<string, unknown>): Pick<ListedNode, "kind" | "text" | "tokensBefore"> | null {
  const userText = userEntryText(entry);
  if (userText !== null) return { kind: "user", text: userText };
  if (entry["type"] === "compaction") {
    const tokens = entry["tokensBefore"];
    return {
      kind: "compaction",
      text: "",
      ...(typeof tokens === "number" && Number.isFinite(tokens) ? { tokensBefore: tokens } : {}),
    };
  }
  if (entry["type"] === "branch_summary") {
    const summary = entry["summary"];
    return { kind: "branch_summary", text: typeof summary === "string" ? summaryPreview(summary) : "" };
  }
  return null;
}

/**
 * 先序（兄弟按会话文件里的先后）展开用户消息、压缩点和分支摘要。缩进只在"父节点有不止一个子节点"时加一级，
 * 一条直线的对话全部在第 0 级。显式栈：长会话的树很深，递归会爆栈。
 * `label` 条目（`targetId` + `label`，空 = 清除）打在对应节点上：同一个目标多次打标签，时间最晚的算（时间相同按遍历顺序）；
 * 打在助手消息等不显示的条目上的标签不显示。
 */
export function buildSessionTree(tree: readonly unknown[], leafId: string | null): SessionTreeNode[] {
  const parentOf = new Map<string, string | null>();
  const listed: ListedNode[] = [];
  const labels = new Map<string, { at: number; label: string | null }>();

  const stack: { node: RawNode; listedParent: number }[] = [];
  for (let i = tree.length - 1; i >= 0; i--) {
    const root = tree[i];
    if (isRawNode(root)) stack.push({ node: root, listedParent: -1 });
  }
  while (stack.length > 0) {
    const { node, listedParent } = stack.pop() as { node: RawNode; listedParent: number };
    const id = node.entry["id"];
    const parentId = node.entry["parentId"];
    if (typeof id === "string") parentOf.set(id, typeof parentId === "string" ? parentId : null);
    let nextParent = listedParent;
    const shown = typeof id === "string" ? displayOf(node.entry) : null;
    if (typeof id === "string" && shown !== null) {
      const index = listed.length;
      listed.push({ entryId: id, ...shown, parent: listedParent, children: [] });
      if (listedParent >= 0) (listed[listedParent] as ListedNode).children.push(index);
      nextParent = index;
    }
    if (node.entry["type"] === "label") {
      const target = node.entry["targetId"];
      const label = node.entry["label"];
      if (typeof target === "string") {
        const at = typeof node.entry["timestamp"] === "string" ? Date.parse(node.entry["timestamp"]) : Number.NaN;
        const previous = labels.get(target);
        const stamp = Number.isNaN(at) ? 0 : at;
        if (previous === undefined || stamp >= previous.at)
          labels.set(target, {
            at: stamp,
            label: typeof label === "string" && label.trim() !== "" ? label.trim() : null,
          });
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (isRawNode(child)) stack.push({ node: child, listedParent: nextParent });
    }
  }

  const onBranch = new Set<string>();
  for (let id = leafId; id !== null && !onBranch.has(id); id = parentOf.get(id) ?? null) onBranch.add(id);

  const indents: number[] = [];
  return listed.map((item, index) => {
    const parent = item.parent >= 0 ? (listed[item.parent] as ListedNode) : null;
    const indent = parent === null ? 0 : (indents[item.parent] as number) + (parent.children.length > 1 ? 1 : 0);
    indents[index] = indent;
    const here = onBranch.has(item.entryId);
    const label = labels.get(item.entryId)?.label ?? null;
    return {
      entryId: item.entryId,
      kind: item.kind,
      text: item.text,
      ...(item.tokensBefore === undefined ? {} : { tokensBefore: item.tokensBefore }),
      ...(label === null ? {} : { label }),
      parent: parent === null ? null : parent.entryId,
      indent,
      onCurrentBranch: here,
      current: here && !item.children.some((child) => onBranch.has((listed[child] as ListedNode).entryId)),
    };
  });
}
