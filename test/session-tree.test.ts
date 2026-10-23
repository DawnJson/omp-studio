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
      { entryId: "u1", kind: "user", text: "第一问", parent: null, indent: 0, onCurrentBranch: true, current: false },
      { entryId: "u2", kind: "user", text: "第二问", parent: "u1", indent: 0, onCurrentBranch: true, current: true },
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

  describe("压缩点、分支摘要和标签", () => {
    const entry = (type: string, id: string, parentId: string | null, extra: object = {}): RawNode => ({
      entry: { type, id, parentId, ...extra },
      children: [],
    });

    it("compaction 和 branch_summary 是树里的节点（带 tokensBefore / 摘要第一句），后面的用户消息挂在它们下面", () => {
      const tree = chain(
        user("u1", null, "问"),
        reply("a1", "u1"),
        entry("compaction", "c1", "a1", { summary: "## Goal\n- x", tokensBefore: 8934 }),
        user("u2", "c1", "又问"),
        entry("branch_summary", "b1", "u2", {
          summary:
            'User explored another conversation branch, then returned here.\nExploration summary:## Goal\nThe user requested "BETA".\n\n## Done\n- x',
        }),
        user("u3", "b1", "第三问"),
      );
      expect(buildSessionTree([tree], "u3")).toEqual([
        { entryId: "u1", kind: "user", text: "问", parent: null, indent: 0, onCurrentBranch: true, current: false },
        {
          entryId: "c1",
          kind: "compaction",
          text: "",
          tokensBefore: 8934,
          parent: "u1",
          indent: 0,
          onCurrentBranch: true,
          current: false,
        },
        { entryId: "u2", kind: "user", text: "又问", parent: "c1", indent: 0, onCurrentBranch: true, current: false },
        {
          entryId: "b1",
          kind: "branch_summary",
          text: 'The user requested "BETA".',
          parent: "u2",
          indent: 0,
          onCurrentBranch: true,
          current: false,
        },
        { entryId: "u3", kind: "user", text: "第三问", parent: "b1", indent: 0, onCurrentBranch: true, current: true },
      ]);
    });

    it("压缩点没写 tokensBefore 时没有这个字段；叶子在压缩点上时它是当前节点", () => {
      const tree = chain(user("u1", null, "问"), entry("compaction", "c1", "u1", { summary: "s" }));
      const nodes = buildSessionTree([tree], "c1");
      expect(nodes[1]).toEqual({
        entryId: "c1",
        kind: "compaction",
        text: "",
        parent: "u1",
        indent: 0,
        onCurrentBranch: true,
        current: true,
      });
      expect(nodes[0]?.current).toBe(false);
    });

    it("label 条目打在目标节点上：最后一次生效，空标签清除，打在不显示的条目上的不出现", () => {
      const u1 = user("u1", null, "问");
      const a1 = reply("a1", "u1");
      const u2 = user("u2", "a1", "又问");
      const l1 = entry("label", "l1", "u2", { targetId: "u1", label: "旧标签", timestamp: "2026-10-22T10:00:00.000Z" });
      const l2 = entry("label", "l2", "l1", {
        targetId: "u1",
        label: " 新标签 ",
        timestamp: "2026-10-22T11:00:00.000Z",
      });
      const l3 = entry("label", "l3", "l2", { targetId: "u2", label: "要清掉", timestamp: "2026-10-22T11:00:00.000Z" });
      const l4 = entry("label", "l4", "l3", { targetId: "u2", label: "", timestamp: "2026-10-22T12:00:00.000Z" });
      const l5 = entry("label", "l5", "l4", { targetId: "a1", label: "助手上的" });
      u1.children.push(a1);
      a1.children.push(u2);
      u2.children.push(l1);
      l1.children.push(l2);
      l2.children.push(l3);
      l3.children.push(l4);
      l4.children.push(l5);
      const nodes = buildSessionTree([u1], "l5");
      expect(nodes.map((node) => [node.entryId, node.label])).toEqual([
        ["u1", "新标签"],
        ["u2", undefined],
      ]);
      expect(nodes[1]).not.toHaveProperty("label");
    });

    it("标签的先后看 timestamp，不看树里的遍历顺序（分支里晚打的标签赢）", () => {
      const u1 = user("u1", null, "问");
      const early = entry("label", "l1", "u1", { targetId: "u1", label: "早", timestamp: "2026-10-22T10:00:00.000Z" });
      const late = entry("label", "l2", "u1", { targetId: "u1", label: "晚", timestamp: "2026-10-22T11:00:00.000Z" });
      u1.children.push(late, early);
      expect(buildSessionTree([u1], "l1")[0]?.label).toBe("晚");
    });
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
