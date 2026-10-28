// 本会话按模型的用量（src/main/history/session-usage.ts）：范围要和 omp 的 get_session_stats 一致（当前分支、
// 最近一次压缩保留下来的部分起），压缩过时另给整个分支的合计；别的分支、坏行不算。
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionUsageAccumulator, summarizeSessionUsage, totalUsage } from "../src/main/history/session-usage.ts";
import { readSessionUsage } from "../src/main/tsp/session-files.ts";
import { feedSessionText, MAX_SESSION_FILE_BYTES } from "../src/main/tsp/session-file-reader.ts";

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
    expect(result.models.map((row) => [row.modelId, row.total, row.cost])).toEqual([
      ["haiku", 300, 0.5],
      ["opus", 150, 1.25],
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
    expect(summarizeSessionUsage(text).models).toMatchObject([{ total: 10 }]);
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
    expect(result.models).toMatchObject([{ total: 230 }]);
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

describe("currentModel（输入框上的显示名有几家重名时认 provider）", () => {
  const change = (id: string, parentId: string | null, model: string, role?: string) =>
    JSON.stringify({ type: "model_change", id, parentId, model, ...(role === undefined ? {} : { role }) });
  const current = (...lines: string[]) => {
    const usage = new SessionUsageAccumulator();
    feedSessionText(lines.join("\n"), [usage]);
    return usage.currentModel();
  };

  it("和 omp 恢复会话一样：会话内临时切换（temporary）算数，重试时换的（fallback）不算；id 里可以有 /；只看当前分支", () => {
    expect(current(user("u1", null))).toBeNull();
    expect(
      current(change("m1", null, "deepseek/deepseek-v4-flash"), change("m2", "m1", "huggingface/moonshotai/Kimi-K3")),
    ).toEqual({ provider: "huggingface", modelId: "moonshotai/Kimi-K3" });
    expect(
      current(
        change("m1", null, "deepseek/deepseek-v4-flash"),
        change("m2", "m1", "anthropic/claude-opus-5-5", "temporary"),
      ),
    ).toEqual({ provider: "anthropic", modelId: "claude-opus-5-5" });
    expect(
      current(
        change("m1", null, "deepseek/deepseek-v4-flash"),
        change("m2", "m1", "anthropic/claude-opus-5-5", "fallback"),
      ),
    ).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    expect(
      current(
        change("m1", null, "deepseek/deepseek-v4-flash"),
        change("m2", "m1", "moonshot/kimi-k3"),
        user("u2", "m1"),
      ),
    ).toEqual({ provider: "deepseek", modelId: "deepseek-v4-flash" });
  });
});

describe("请求数和合计（TSP 任务的 sessionUsage 用）", () => {
  it("requests 是各模型的 assistant 消息数；totalUsage 把 token 分项和请求数相加", () => {
    const text = [
      user("u1", null),
      reply("a1", "u1", "opus", 100, 1),
      reply("a2", "a1", "haiku", 300, 0.5),
      reply("a3", "a2", "opus", 50, 0.25),
    ].join("\n");
    const { models } = summarizeSessionUsage(text);
    expect(models.map((row) => [row.modelId, row.requests])).toEqual([
      ["haiku", 1],
      ["opus", 2],
    ]);
    // reply() 里每条 input 为 1，output 为 total - 1。
    expect(totalUsage(models)).toEqual({
      tokens: { input: 3, output: 447, cacheRead: 0, cacheWrite: 0, total: 450 },
      requests: 3,
    });
    expect(totalUsage([])).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      requests: 0,
    });
  });
});

describe("readSessionUsage（读文件）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omp usage 会话 "));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("没有文件（新会话第一条回复之后才落盘）是空表；没有路径也是空表", async () => {
    const empty = { models: [], compactions: 0, whole: null };
    expect(await readSessionUsage(path.join(dir, "还没有.jsonl"))).toEqual(empty);
    expect(await readSessionUsage(null)).toEqual(empty);
  });

  it("文件超过上限（和 readSessionEntries 同一个）就报错，不整份读进内存", async () => {
    const file = path.join(dir, "太大 的会话.jsonl");
    const handle = await open(file, "w");
    await handle.truncate(MAX_SESSION_FILE_BYTES + 1);
    await handle.close();
    await expect(readSessionUsage(file)).rejects.toThrow(/too large to read/);
  });

  it("正常大小的文件照常算", async () => {
    const file = path.join(dir, "ok.jsonl");
    await writeFile(file, `${reply("a", null, "m1", 10, 0.5)}\n`, "utf8");
    const usage = await readSessionUsage(file);
    expect(usage.models.map((row) => [row.modelId, row.total, row.cost])).toEqual([["m1", 10, 0.5]]);
  });
});
