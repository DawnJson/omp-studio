// 本会话按模型的用量（src/main/history/session-usage.ts）：范围要和 omp 的 get_session_stats 一致（当前分支、
// 最近一次压缩保留下来的部分起），压缩过时另给整个分支的合计；别的分支、坏行不算。
import { describe, expect, it } from "vitest";
import { summarizeSessionUsage } from "../src/main/history/session-usage.ts";

let seq = 0;
const reply = (id: string, parentId: string | null, model: string, total: number, cost: number) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    message: {
      role: "assistant",
      provider: "anthropic",
      model,
      usage: { input: 1, output: total - 1, cacheRead: 0, cacheWrite: 0, totalTokens: total, cost: { total: cost } },
    },
    seq: seq++,
  });
const user = (id: string, parentId: string | null) =>
  JSON.stringify({ type: "message", id, parentId, message: { role: "user", content: [] } });

describe("summarizeSessionUsage", () => {
  it("按模型相加，大的排前；没有回复是空表", () => {
    const text = [
      user("u1", null),
      reply("a1", "u1", "opus", 100, 1),
      reply("a2", "a1", "haiku", 300, 0.5),
      reply("a3", "a2", "opus", 50, 0.25),
    ].join("\n");
    const result = summarizeSessionUsage(text);
    expect(result.models.map((row) => [row.modelId, row.replies, row.total, row.cost])).toEqual([
      ["haiku", 1, 300, 0.5],
      ["opus", 2, 150, 1.25],
    ]);
    expect(result.whole).toBeNull();
    expect(summarizeSessionUsage("").models).toEqual([]);
  });

  it("只算最后一条所在的分支；坏行和写到一半的行跳过", () => {
    const text = [
      user("u1", null),
      reply("old", "u1", "opus", 1000, 9),
      reply("new", "u1", "opus", 10, 0.1),
      "{not json",
      '{"type":"message","id":"half',
    ].join("\n");
    expect(summarizeSessionUsage(text).models).toMatchObject([{ total: 10, replies: 1 }]);
  });

  it("压缩过：从 firstKeptEntryId 起算，whole 是整个分支", () => {
    const text = [
      user("u1", null),
      reply("a1", "u1", "opus", 1000, 10),
      reply("a2", "a1", "opus", 200, 2),
      JSON.stringify({ type: "compaction", id: "c1", parentId: "a2", firstKeptEntryId: "a2" }),
      reply("a3", "c1", "opus", 30, 0.3),
    ].join("\n");
    const result = summarizeSessionUsage(text);
    expect(result.models).toMatchObject([{ total: 230, replies: 2 }]);
    expect(result.compactions).toBe(1);
    expect(result.whole).toEqual({ total: 1230, cost: 12.3 });
  });

  it("压缩没写 firstKeptEntryId：从压缩之后算", () => {
    const text = [
      reply("a1", null, "opus", 1000, 10),
      JSON.stringify({ type: "compaction", id: "c1", parentId: "a1" }),
      reply("a2", "c1", "opus", 5, 0.05),
    ].join("\n");
    expect(summarizeSessionUsage(text).models).toMatchObject([{ total: 5 }]);
  });
});
