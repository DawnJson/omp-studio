// 会话树面板的纯逻辑（src/shared/session-tree-view.ts）：回溯会丢掉几轮、搜索过滤。用真实会话文件（fixtures/omp-session）建的树。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discardedTurns, filterTreeNodes } from "../src/shared/session-tree-view.ts";
import { buildTreeFromSessionText } from "../src/main/tsp/session-tree-file.ts";
import { focusIndexFromEnd } from "../src/renderer/src/features/conversation/tree-focus.ts";

const read = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", "fixtures", "omp-session", `${name}.jsonl`), "utf8");
const ALPHA = "beac8e08";
const BETA = "b772c2f5";
const GAMMA = "47b8e31d";

describe("discardedTurns", () => {
  it("直线对话：回到 BETA 丢 1 轮（BETA 自己），回到 ALPHA 丢 2 轮", () => {
    const nodes = buildTreeFromSessionText(read("linear"));
    expect(discardedTurns(nodes, BETA)).toBe(1);
    expect(discardedTurns(nodes, ALPHA)).toBe(2);
  });

  it("目标在别的分支上：当前分支里公共祖先之后的都离开（回到 BETA 离开 GAMMA）", () => {
    const nodes = buildTreeFromSessionText(read("branched"));
    // 当前分支 = ALPHA → GAMMA；BETA 是 ALPHA 下的另一支，回到它之前 = 叶子移到 ALPHA 的回复，ALPHA 留下、GAMMA 离开。
    expect(discardedTurns(nodes, BETA)).toBe(1);
    expect(discardedTurns(nodes, GAMMA)).toBe(1);
    expect(discardedTurns(nodes, ALPHA)).toBe(2);
  });

  it("压缩点、摘要节点和不存在的 id：0，压缩点 / 摘要不算一轮", () => {
    const nodes = buildTreeFromSessionText(read("compacted"));
    expect(discardedTurns(nodes, "7e4ee1fd")).toBe(0);
    expect(discardedTurns(nodes, "nope")).toBe(0);
    // 压缩点是叶子：回到 ALPHA 丢的是当前分支上 ALPHA 起的两条用户消息，压缩点不计数。
    expect(discardedTurns(nodes, "5bc4a7a2")).toBe(2);
    const summarized = buildTreeFromSessionText(read("summarized"));
    expect(discardedTurns(summarized, "a3351bfc")).toBe(0);
  });
});

describe("filterTreeNodes", () => {
  const nodes = buildTreeFromSessionText(read("branched")).map((node) =>
    node.entryId === BETA ? { ...node, label: "Keep This" } : node,
  );

  it("空查询原样返回（新数组）", () => {
    expect(filterTreeNodes(nodes, "  ")).toEqual(nodes);
    expect(filterTreeNodes(nodes, "")).not.toBe(nodes);
  });

  it("按消息文字过滤，不分大小写，多个词都要出现", () => {
    expect(filterTreeNodes(nodes, "gamma").map((node) => node.entryId)).toEqual([GAMMA]);
    expect(filterTreeNodes(nodes, "REPLY exactly").map((node) => node.entryId)).toEqual([ALPHA, BETA, GAMMA]);
    expect(filterTreeNodes(nodes, "gamma alpha")).toEqual([]);
  });

  it("也搜标签", () => {
    expect(filterTreeNodes(nodes, "keep this").map((node) => node.entryId)).toEqual([BETA]);
  });

  it("过滤不改节点本身（缩进、当前标记照旧）", () => {
    expect(filterTreeNodes(nodes, "gamma")[0]).toBe(nodes[2]);
  });
});

describe("focusIndexFromEnd 只数用户消息", () => {
  it("压缩点在当前分支上也不占一个名额", () => {
    const nodes = buildTreeFromSessionText(read("compacted"));
    expect(focusIndexFromEnd(nodes, 0)).toBe(1);
    expect(focusIndexFromEnd(nodes, 1)).toBe(0);
    expect(focusIndexFromEnd(nodes, 2)).toBeNull();
  });
});
