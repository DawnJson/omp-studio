// 会话文件的增量读取（src/main/tsp/session-file-reader.ts）：分几次追加读到的结果要和整份文本一次解析的一样；
// 写到一半的最后一行留到下次；文件被重写、截短、删掉时从头读；跨块的多字节字符、同时调用 update 都不出错。
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionUsageAccumulator, summarizeSessionUsage } from "../src/main/history/session-usage.ts";
import { readSessionUsage } from "../src/main/tsp/session-files.ts";
import { parseSession, SessionExtrasAccumulator } from "../src/main/tsp/session-extras.ts";
import { SessionFileReader } from "../src/main/tsp/session-file-reader.ts";

const header = (title: string) => JSON.stringify({ type: "session", id: "sess-1", title, cwd: "E:/项目 目录" });
const user = (id: string, parentId: string | null, timestamp: number, text = "你好") =>
  JSON.stringify({ type: "message", id, parentId, message: { role: "user", timestamp, content: text } });
const reply = (id: string, parentId: string, model: string, total: number, cost: number, completedAt: number) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    message: {
      role: "assistant",
      provider: "anthropic",
      model,
      stopReason: "stop",
      completedAt,
      timestamp: completedAt,
      duration: 2000,
      ttft: 500,
      content: "回答：多字节 🚀 字符",
      usage: { input: 1, output: total - 1, cacheRead: 0, cacheWrite: 0, totalTokens: total, cost: { total: cost } },
    },
  });
const compaction = (id: string, parentId: string, firstKeptEntryId: string) =>
  JSON.stringify({ type: "compaction", id, parentId, firstKeptEntryId, summary: "压缩摘要" });

const lines = [
  header("第一个标题"),
  user("u1", null, 1000),
  reply("a1", "u1", "opus", 100, 1, 3000),
  user("u2", "a1", 4000, "第二轮 🧪"),
  reply("a2", "u2", "模型🚀", 300, 0.5, 9000),
  compaction("c1", "a2", "u2"),
  user("u3", "c1", 10_000),
  reply("a3", "u3", "opus", 50, 0.25, 12_000),
];

const expected = (text: string) => ({ usage: summarizeSessionUsage(text), extras: parseSession(text) });

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp usage 会话 "));
  file = path.join(dir, "会话 文件.jsonl");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function track(chunkBytes?: number) {
  const usage = new SessionUsageAccumulator();
  const extras = new SessionExtrasAccumulator();
  const reader = new SessionFileReader(file, [usage, extras], chunkBytes === undefined ? {} : { chunkBytes });
  return {
    reader,
    async read() {
      await reader.update();
      return { usage: usage.summary(), extras: extras.result() };
    },
  };
}

describe("SessionFileReader（增量读会话文件）", () => {
  it("分几次追加读到的用量和脚注，和整份文本一次解析的一样", async () => {
    const tail = track();
    await writeFile(file, "", "utf8");
    expect(await tail.read()).toEqual(expected(""));
    for (let count = 1; count <= lines.length; count++) {
      await appendFile(file, `${lines[count - 1]}\n`, "utf8");
      if (count % 3 !== 0 && count !== lines.length) continue;
      expect(await tail.read()).toEqual(expected(lines.slice(0, count).join("\n")));
    }
    const final = await tail.read();
    expect(final.usage.compactions).toBe(1);
    expect(final.extras.turns).toHaveLength(3);
    expect(final).toEqual(expected(lines.join("\n")));
  });

  it("写到一半的最后一行（没有换行）先不算，写完后只算一次", async () => {
    const tail = track();
    const last = lines[lines.length - 1]!;
    const before = lines.slice(0, -1);
    await writeFile(file, `${before.join("\n")}\n${last.slice(0, 40)}`, "utf8");
    expect(await tail.read()).toEqual(expected(before.join("\n")));
    await appendFile(file, last.slice(40), "utf8");
    // 完整但还没换行：omp 还在写，照样等。
    expect(await tail.read()).toEqual(expected(before.join("\n")));
    await appendFile(file, "\n", "utf8");
    expect(await tail.read()).toEqual(expected(lines.join("\n")));
    expect(await tail.read()).toEqual(expected(lines.join("\n")));
  });

  it("文件被重写（第一行变长、变短）、截短、删掉时从头读", async () => {
    const tail = track();
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(lines.join("\n")));

    // omp 改了第一行的标题：后面的字节整体挪位，内容换成另一个分支。
    const longer = [
      header("一个长得多的新标题 —— 重写过"),
      ...lines.slice(1, 3),
      reply("b2", "a1", "haiku", 7, 0.07, 5000),
    ];
    await writeFile(file, `${longer.join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(longer.join("\n")));

    const shorter = [header("短"), ...lines.slice(1)];
    await writeFile(file, `${shorter.join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(shorter.join("\n")));

    const truncated = lines.slice(0, 3);
    await writeFile(file, `${truncated.join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(truncated.join("\n")));

    await rm(file);
    expect(await tail.read()).toEqual(expected(""));
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(lines.join("\n")));
  });

  it("多字节字符被读缓冲切开时照常解码（每块 5 字节）", async () => {
    const tail = track(5);
    await writeFile(file, `${lines.slice(0, 4).join("\n")}\n`, "utf8");
    expect(await tail.read()).toEqual(expected(lines.slice(0, 4).join("\n")));
    await appendFile(file, `${lines.slice(4).join("\n")}\n`, "utf8");
    const result = await tail.read();
    expect(result).toEqual(expected(lines.join("\n")));
    expect(result.usage.models.map((row) => row.modelId)).toContain("模型🚀");
  });

  it("同时调用 update 不会重复累加", async () => {
    const tail = track(64);
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
    await Promise.all([tail.reader.update(), tail.reader.update(), tail.reader.update()]);
    const result = await tail.read();
    expect(result).toEqual(expected(lines.join("\n")));
    // 压缩保留 u2 起：a2、a3 两条回复。
    expect(result.usage.models.reduce((sum, row) => sum + row.requests, 0)).toBe(2);
    expect(result.extras.turns).toHaveLength(3);
  });

  it("readSessionUsage（IPC 用）缓存读取器：追加后再查只读新的完整行，结果和整份文本一样；写到一半的行等它的换行", async () => {
    await writeFile(file, `${lines.slice(0, 4).join("\n")}\n`, "utf8");
    expect(await readSessionUsage(file)).toEqual(summarizeSessionUsage(lines.slice(0, 4).join("\n")));
    await appendFile(file, `${lines.slice(4).join("\n")}\n${lines[7]!.slice(0, 20)}`, "utf8");
    expect(await readSessionUsage(file)).toEqual(summarizeSessionUsage(lines.join("\n")));
  });
});
