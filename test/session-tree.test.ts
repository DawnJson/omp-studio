// 会话树的原始节点 → 面板节点（缩进、当前分支、当前节点）。
import { describe, expect, it } from "vitest";
import { buildSessionTree, userEntryText } from "../src/main/tasks/session-tree.ts";

interface RawNode {
  entry: Record<string, unknown>;
  children: RawNode[];
}

function message(id: string, parentId: string | null, role: string, content: unknown, extra: object = {}): RawNode {
  return { entry: { type: "message", id, parentId, message: { role, content, ...extra } }, children: [] };
}
const user = (id: string, parentId: string | null, text: string, extra: object = {}) =>
  message(id, parentId, "user", [{ type: "text", text }], extra);
const reply = (id: string, parentId: string) => message(id, parentId, "assistant", [{ type: "text", text: "ok" }]);
const other = (id: string, parentId: string | null, type: string): RawNode => ({
  entry: { type, id, parentId },
  children: [],
});
function chain(...nodes: RawNode[]): RawNode {
  nodes.reduceRight((child, parent) => {
    parent.children.push(child);
    return parent;
  });
  return nodes[0] as RawNode;
}

describe("buildSessionTree", () => {
  it("直线对话：只列用户消息，缩进全是 0，最后一条用户消息是当前节点", () => {
    const tree = chain(
      other("m", null, "model_change"),
      user("u1", "m", "第一问"),
      reply("a1", "u1"),
      user("u2", "a1", "第二问"),
      reply("a2", "u2"),
    );
    expect(buildSessionTree([tree], "a2")).toEqual([
      { entryId: "u1", text: "第一问", indent: 0, onCurrentBranch: true, current: false },
      { entryId: "u2", text: "第二问", indent: 0, onCurrentBranch: true, current: true },
    ]);
  });

  it("分叉：兄弟分支缩进一级，叶子不在的分支不算当前分支，先序按文件里的先后", () => {
    // u1 → a1 → { u2 → a2, u3 → a3 → u4 }；叶子在 u3 → a3 之下
    const a1 = reply("a1", "u1");
    const u1 = user("u1", null, "根");
    const u2 = user("u2", "a1", "分支甲");
    const u3 = user("u3", "a1", "分支乙");
    const u4 = user("u4", "a3", "乙之后");
    const a2 = reply("a2", "u2");
    const a3 = reply("a3", "u3");
    u1.children.push(a1);
    a1.children.push(u2, u3);
    u2.children.push(a2);
    u3.children.push(a3);
    a3.children.push(u4);

    const nodes = buildSessionTree([u1], "a3");

    expect(nodes.map((n) => [n.entryId, n.indent, n.onCurrentBranch, n.current])).toEqual([
      ["u1", 0, true, false],
      ["u2", 1, false, false],
      ["u3", 1, true, true],
      ["u4", 1, false, false],
    ]);
  });

  it("叶子在用户消息自己上（branch 之前的状态）时那条消息是当前节点", () => {
    const tree = chain(user("u1", null, "问"), reply("a1", "u1"), user("u2", "a1", "又问"));
    expect(buildSessionTree([tree], "u2").map((n) => n.current)).toEqual([false, true]);
  });

  it("叶子为 null 或不在树里：没有当前分支，不抛错", () => {
    const tree = chain(user("u1", null, "问"), reply("a1", "u1"));
    expect(buildSessionTree([tree], null).map((n) => [n.onCurrentBranch, n.current])).toEqual([[false, false]]);
    expect(buildSessionTree([tree], "missing").map((n) => n.onCurrentBranch)).toEqual([false]);
  });

  it("没有用户消息、或树为空：空列表", () => {
    expect(buildSessionTree([], null)).toEqual([]);
    expect(buildSessionTree([chain(other("m", null, "model_change"))], "m")).toEqual([]);
  });

  it("很深的对话（几万个条目）不会爆栈", () => {
    const nodes: RawNode[] = [];
    for (let i = 0; i < 20_000; i++) nodes.push(i % 2 === 0 ? user(`n${i}`, null, `问${i}`) : reply(`n${i}`, "x"));
    const result = buildSessionTree([chain(...nodes)], "n19999");
    expect(result).toHaveLength(10_000);
    expect(result.at(-1)).toMatchObject({ entryId: "n19998", indent: 0 });
  });

  it("畸形节点（缺 entry / children、没有 id）跳过，不抛错", () => {
    const tree = [null, { entry: null, children: [] }, { entry: {}, children: "x" }, user("u1", null, "好")];
    expect(buildSessionTree(tree, "u1").map((n) => n.entryId)).toEqual(["u1"]);
  });
});

describe("userEntryText", () => {
  it("取第一行非空文字；超长截断；字符串内容也认", () => {
    expect(userEntryText(user("u", null, "\n\n  第一行  \n第二行").entry)).toBe("第一行");
    expect(userEntryText(message("u", null, "user", "纯字符串").entry)).toBe("纯字符串");
    expect(userEntryText(user("u", null, "x".repeat(300)).entry)).toBe(`${"x".repeat(200)}…`);
  });

  it("只有图片的用户消息文字为空串；omp 注入的（attribution=agent）和非用户消息不是节点", () => {
    expect(userEntryText(message("u", null, "user", [{ type: "image" }]).entry)).toBe("");
    expect(userEntryText(user("u", null, "注入", { attribution: "agent" }).entry)).toBeNull();
    expect(userEntryText(reply("a", "u").entry)).toBeNull();
    expect(userEntryText(other("m", null, "model_change").entry)).toBeNull();
  });
});
