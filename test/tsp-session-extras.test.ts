import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSession, readLatestRecap, readSessionExtras, recapDisplayText } from "../src/main/tsp/session-extras.ts";
import { formatDuration, formatTokens, formatTurnFooter } from "../src/renderer/src/features/tsp/turn-footer.ts";
import { loadTspFixture, tspFixtureDir } from "./tsp-fixtures.ts";

const SESSION_ID = "01a156e2-5573-752f-ae26-c89b4b0fd495";
const header = JSON.stringify({ type: "session", id: "sess-1", cwd: "E:/x" });
const user = (timestamp: number, attribution = "user") =>
  JSON.stringify({ type: "message", message: { role: "user", attribution, timestamp, content: "hi" } });
const assistant = (
  stopReason: string,
  usage: Record<string, unknown>,
  completedAt?: number,
  timestamp = completedAt ?? 0,
) => JSON.stringify({ type: "message", message: { role: "assistant", stopReason, usage, completedAt, timestamp } });
const tokens = (input: number, output: number, total: number, extra: Record<string, unknown> = {}) => ({
  input,
  output,
  cacheWrite: 0,
  cost: { total },
  ...extra,
});

describe("parseSession（会话文件 → 每轮用量脚注）", () => {
  it("一轮里的多次工具调用累加，耗时 = 最终回复的 completedAt − 用户消息 timestamp", () => {
    const text = [
      header,
      user(1000),
      assistant("toolUse", tokens(100, 10, 0.001), 1500),
      assistant("stop", tokens(50, 5, 0.002), 4000),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: 3000, input: 150, output: 15, cost: 0.003 }]);
  });

  it("cacheWrite 算输入，orchestration 的 token 并入；缓存读取不算", () => {
    const text = [
      user(0),
      assistant("stop", {
        input: 10,
        output: 2,
        cacheRead: 999,
        cacheWrite: 5,
        orchestration: { input: 3, output: 4 },
        cost: { total: 0 },
      }),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: null, input: 18, output: 6, cost: 0 }]);
  });

  it("每个非 agent 用户消息一项：没结束的轮、没有用量的轮是 null；agent 归属的用户消息不开新轮", () => {
    const text = [
      user(1),
      assistant("stop", tokens(1, 1, 0.1), 10),
      user(2),
      assistant("toolUse", tokens(1, 1, 0.1), 20),
      user(3),
      assistant("stop", tokens(0, 0, 0), 30),
      user(4, "agent"),
      assistant("stop", tokens(7, 3, 0.4), 50),
    ].join("\n");
    const { turns } = parseSession(text);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ elapsedMs: 9, input: 1, output: 1, cost: 0.1 });
    expect(turns[1]).toBeNull();
    // 第 3 轮：空回复没用量 → null，agent 消息之后的回复算在这一轮里
    expect(turns[2]).toEqual({ elapsedMs: 47, input: 7, output: 3, cost: 0.4 });
  });

  it("坏行（含写到一半的最后一行）跳过；读出会话 id 和最后一条消息的时间", () => {
    const text = [header, user(5), assistant("stop", tokens(1, 1, 0), 9, 8), '{"type":"mess'].join("\n");
    const parsed = parseSession(text);
    expect(parsed.id).toBe("sess-1");
    expect(parsed.lastMessageAt).toBe(8);
    expect(parsed.turns).toHaveLength(1);
  });

  it("真实录制的会话（fixtures/tsp/resume-session.jsonl，3 个用户消息）", async () => {
    const text = await readFile(path.join(tspFixtureDir, "resume-session.jsonl"), "utf8");
    const parsed = parseSession(text);
    expect(parsed.id).toBe(SESSION_ID);
    expect(parsed.turns).toEqual([
      { elapsedMs: 11215, input: 1973, output: 886, cost: 0.001909308 },
      { elapsedMs: 47454, input: 1659, output: 1115, cost: 0.002302644 },
      { elapsedMs: 4684, input: 838, output: 259, cost: 0.000899352 },
    ]);
  });
});

describe("脚注文字（和 omp 的 tLo 同格式）", () => {
  it("耗时、token 数的缩写和 omp 一致", () => {
    expect(formatDuration(244)).toBe("244ms");
    expect(formatDuration(11215)).toBe("11.2s");
    expect(formatDuration(125_000)).toBe("2m5s");
    expect(formatDuration(3_780_000)).toBe("1h3m");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatTokens(728)).toBe("728");
    expect(formatTokens(2859)).toBe("2.9K");
    expect(formatTokens(13_400)).toBe("13K");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("文字和悬停提示；费用一分钱以下写准确值，没有耗时 / 费用的项省略", () => {
    expect(formatTurnFooter({ elapsedMs: 11215, input: 1973, output: 886, cost: 0.001909308 })).toEqual({
      text: "11.2s · 2.9K tok · $0.0019 this turn",
      title: "This turn: 11.2s · 2,859 tokens (1,973 in · 886 out) · $0.0019",
    });
    expect(formatTurnFooter({ elapsedMs: null, input: 600, output: 128, cost: 0 }).text).toBe("728 tok this turn");
    expect(formatTurnFooter({ elapsedMs: 500, input: 10, output: 5, cost: 0.42 }).text).toBe(
      "500ms · 15 tok · $0.42 this turn",
    );
  });
});

describe("空闲回顾（history.db 的 session_recaps）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omp recap 测试-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** 和 omp 18.12.4 的表结构一致（从 omp 二进制里的建表语句抄的）。 */
  function seed(
    rows: { sessionId: string; recap: string; createdAt: number }[],
    file = path.join(dir, "history.db"),
  ): string {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)))",
    );
    const insert = db.prepare(
      "INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES (?, 'E:/x', ?, ?)",
    );
    for (const row of rows) insert.run(row.sessionId, row.recap, row.createdAt);
    db.close();
    return file;
  }

  it("取这个会话最新的一条；折叠空白、最多 280 字", () => {
    const file = seed([
      { sessionId: "a", recap: "old", createdAt: 100 },
      { sessionId: "a", recap: "  新的\n回顾  ", createdAt: 200 },
      { sessionId: "b", recap: "别的会话", createdAt: 300 },
    ]);
    expect(readLatestRecap(file, "a", 150_000)).toBe("新的 回顾");
    expect(readLatestRecap(file, "c", 0)).toBeNull();
    expect(recapDisplayText("x".repeat(400))).toHaveLength(280);
    expect(recapDisplayText("x".repeat(400)).endsWith("…")).toBe(true);
  });

  it("回顾之后会话又有新消息：已过时，不显示（1 秒内的误差不算）", () => {
    const file = seed([{ sessionId: "a", recap: "r", createdAt: 200 }]);
    expect(readLatestRecap(file, "a", 200_900)).toBe("r");
    expect(readLatestRecap(file, "a", 201_001)).toBeNull();
  });

  it("库不存在、没有 session_recaps 表：null，不抛错", () => {
    expect(readLatestRecap(path.join(dir, "none.db"), "a", 0)).toBeNull();
    const file = path.join(dir, "other.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (x)");
    db.close();
    expect(readLatestRecap(file, "a", 0)).toBeNull();
  });

  it("readSessionExtras：会话文件 + agent 目录的 history.db（路径带空格和中文）", async () => {
    const agentDir = path.join(dir, "agent 目录");
    await mkdir(agentDir);
    seed([{ sessionId: SESSION_ID, recap: "回顾 text", createdAt: 1792459900 }], path.join(agentDir, "history.db"));
    const file = path.join(tspFixtureDir, "resume-session.jsonl");
    const extras = await readSessionExtras(file, agentDir);
    expect(extras.turns).toHaveLength(3);
    expect(extras.recap).toBe("回顾 text");
    // 没有会话文件 / 文件读不到：空
    expect(await readSessionExtras(null, agentDir)).toEqual({ turns: [], recap: null });
    expect(await readSessionExtras(path.join(dir, "missing.jsonl"), agentDir)).toEqual({ turns: [], recap: null });
    // history.db 损坏：只丢回顾，用量脚注还在
    await writeFile(path.join(agentDir, "history.db"), "not a database");
    const broken = await readSessionExtras(file, agentDir);
    expect(broken.turns).toHaveLength(3);
    expect(broken.recap).toBeNull();
  });
});

describe("omp 18.12.4 恢复会话的实录（fixtures/tsp/resume.jsonl）", () => {
  it("整段旧对话重发了（3 个 omp.user、每条助手消息一个 omp.assistant），但没有 omp.turn.usage 行——所以 studio 要补", () => {
    const text = JSON.stringify(loadTspFixture("resume"));
    expect(text.match(/"role":"omp\.user"/g)).toHaveLength(3);
    expect(text).toContain('"role":"omp.assistant"');
    expect(text).not.toContain("omp.turn.usage");
    expect(text).not.toContain("omp.recap");
  });
});
