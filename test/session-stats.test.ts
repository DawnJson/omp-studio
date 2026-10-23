import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createT } from "../src/shared/i18n/index.ts";
import { describeError } from "../src/shared/ui/errors.ts";
import { readSessionTrace, TRACE_LIMIT } from "../src/main/session-info/session-stats.ts";

// 表结构抄自 omp 18.12.5 的 stats.db（只留本功能用到的列之外的 NOT NULL 列，保证插入语句和真实库同样严格）。
const SCHEMA = `
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_file TEXT NOT NULL, entry_id TEXT NOT NULL, folder TEXT NOT NULL,
  model TEXT NOT NULL, provider TEXT NOT NULL, api TEXT NOT NULL, timestamp INTEGER NOT NULL, duration INTEGER, ttft INTEGER,
  stop_reason TEXT NOT NULL, error_message TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
  premium_requests REAL NOT NULL, cost_input REAL NOT NULL, cost_output REAL NOT NULL, cost_cache_read REAL NOT NULL,
  cost_cache_write REAL NOT NULL, cost_total REAL NOT NULL, cost_no_cache_input REAL,
  agent_type TEXT NOT NULL DEFAULT 'main', cost_unpriced INTEGER NOT NULL DEFAULT 0, service_tier TEXT,
  UNIQUE(session_file, entry_id)
);
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_file TEXT NOT NULL, entry_id TEXT NOT NULL, tool_call_id TEXT NOT NULL,
  folder TEXT NOT NULL, tool_name TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, timestamp INTEGER NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'main', calls_in_turn INTEGER NOT NULL DEFAULT 1, args_chars INTEGER NOT NULL DEFAULT 0,
  result_chars INTEGER, is_error INTEGER, UNIQUE(session_file, tool_call_id)
);
CREATE TABLE session_rollup (
  session_file TEXT PRIMARY KEY, requests INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL, cost_total REAL NOT NULL, unpriced INTEGER NOT NULL, models TEXT, tool_calls INTEGER NOT NULL
) WITHOUT ROWID;
`;

let dir: string;
let dbPath: string;
// 路径里有空格和中文：和 omp 在 Windows 上写进库的反斜杠绝对路径同一类。
const sessionFile = path.resolve(os.tmpdir(), "omp 会话 test", "2026-10-21T10-00-00-000Z_01a0.jsonl");
const otherFile = path.resolve(os.tmpdir(), "omp 会话 test", "2026-10-21T11-00-00-000Z_01a1.jsonl");

interface MessageSeed {
  file: string;
  entry: string;
  timestamp: number;
  model?: string;
  stop?: string;
  error?: string | null;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  duration?: number | null;
  ttft?: number | null;
  agent?: string;
  tier?: string | null;
}

function insertMessage(db: DatabaseSync, seed: MessageSeed): void {
  db.prepare(
    `INSERT INTO messages (session_file, entry_id, folder, model, provider, api, timestamp, duration, ttft, stop_reason,
       error_message, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, premium_requests,
       cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, agent_type, service_tier)
     VALUES (?, ?, 'C:/work/project', ?, 'deepseek', 'openai-completions', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
  ).run(
    seed.file,
    seed.entry,
    seed.model ?? "deepseek-v4-flash",
    seed.timestamp,
    seed.duration === undefined ? 5000 : seed.duration,
    seed.ttft === undefined ? 1000 : seed.ttft,
    seed.stop ?? "stop",
    seed.error ?? null,
    seed.input ?? 10,
    seed.output ?? 20,
    seed.cacheRead ?? 0,
    seed.cacheWrite ?? 0,
    (seed.input ?? 10) + (seed.output ?? 20) + (seed.cacheRead ?? 0) + (seed.cacheWrite ?? 0),
    seed.cost ?? 0.01,
    seed.agent ?? "main",
    seed.tier ?? null,
  );
}

function insertTool(
  db: DatabaseSync,
  file: string,
  entry: string,
  callId: string,
  name: string,
  isError: number | null,
) {
  db.prepare(
    `INSERT INTO tool_calls (session_file, entry_id, tool_call_id, folder, tool_name, model, provider, timestamp, args_chars, result_chars, is_error)
     VALUES (?, ?, ?, 'C:/work/project', ?, 'deepseek-v4-flash', 'deepseek', 1, 12, 340, ?)`,
  ).run(file, entry, callId, name, isError);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 会话信息 "));
  dbPath = path.join(dir, "stats.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO session_rollup VALUES (?, 8, 1000, 9000.5, 259673, 0.210946, 1, 'grok-4.6,deepseek-v4-flash', 10)",
  ).run(sessionFile);
  db.prepare("INSERT INTO session_rollup VALUES (?, 1, 1, 2, 5, 0.5, 0, NULL, 0)").run(otherFile);
  insertMessage(db, {
    file: sessionFile,
    entry: "m1",
    timestamp: 1_000,
    input: 4,
    output: 150,
    cost: 0.0229732,
    duration: 5712.76,
    ttft: 3048.44,
    stop: "toolUse",
  });
  insertMessage(db, {
    file: sessionFile,
    entry: "m2",
    timestamp: 3_000,
    input: 2,
    output: 189,
    cacheRead: 700,
    cacheWrite: 50,
    stop: "stop",
    tier: "priority",
  });
  insertMessage(db, {
    file: sessionFile,
    entry: "m3",
    timestamp: 2_000,
    stop: "error",
    error: "401 Authentication Fails",
    duration: null,
    ttft: null,
    agent: "Alpha",
  });
  insertMessage(db, { file: otherFile, entry: "x1", timestamp: 500 });
  insertTool(db, sessionFile, "m1", "c1", "web_search", 0);
  insertTool(db, sessionFile, "m1", "c2", "read", 1);
  insertTool(db, sessionFile, "m2", "c3", "bash", null);
  insertTool(db, otherFile, "x1", "c9", "read", 0);
  db.close();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Windows 路径写法", () => {
  it.runIf(process.platform === "win32")(
    "盘符大小写、斜杠方向不影响匹配（任务记录和 omp 写库的路径写法可能不同）",
    () => {
      const mangled = sessionFile.toLowerCase().replaceAll("\\", "/");
      expect(readSessionTrace(dbPath, mangled).requests).toHaveLength(3);
    },
  );
});

describe("表结构自检（omp 升级改了表时给明确错误，不返回空白）", () => {
  it("缺列：错误里写明哪张表缺哪一列", () => {
    const broken = path.join(dir, "缺列.db");
    const db = new DatabaseSync(broken);
    db.exec(SCHEMA.replace("duration INTEGER, ttft INTEGER,", "duration INTEGER,"));
    db.close();
    expect(() => readSessionTrace(broken, sessionFile)).toThrow(/schema mismatch.*table messages has no column ttft/);
  });

  it("缺表：错误里写明哪张表不存在", () => {
    const broken = path.join(dir, "缺表.db");
    const db = new DatabaseSync(broken);
    db.exec("CREATE TABLE unrelated (x INTEGER)");
    db.close();
    expect(() => readSessionTrace(broken, sessionFile)).toThrow(
      /schema mismatch.*table messages is missing; table tool_calls is missing/,
    );
  });

  it("界面把它认作已知错误（不是通用的“操作没有完成”）", () => {
    const t = createT("en");
    expect(describeError(t, new Error("omp stats.db schema mismatch: table messages is missing"))).toBe(
      t("error.statsSchema"),
    );
  });
});

describe("readSessionTrace（messages + tool_calls）", () => {
  it("从新到旧；工具调用按 entry_id 挂在发起它的请求上；is_error 三态", () => {
    const trace = readSessionTrace(dbPath, sessionFile);
    expect(trace.hasDatabase).toBe(true);
    expect(trace.truncated).toBe(false);
    expect(trace.requests.map((request) => request.entryId)).toEqual(["m2", "m3", "m1"]);
    const m1 = trace.requests[2]!;
    expect(m1).toMatchObject({
      model: "deepseek-v4-flash",
      provider: "deepseek",
      agentType: "main",
      stopReason: "toolUse",
      errorMessage: null,
      input: 4,
      output: 150,
      costUsd: 0.0229732,
      durationMs: 5712.76,
      ttftMs: 3048.44,
      serviceTier: null,
    });
    expect(m1.tools).toEqual([
      { name: "web_search", isError: false, argsChars: 12, resultChars: 340 },
      { name: "read", isError: true, argsChars: 12, resultChars: 340 },
    ]);
    expect(trace.requests[0]!.tools).toEqual([{ name: "bash", isError: null, argsChars: 12, resultChars: 340 }]);
    expect(trace.requests[0]).toMatchObject({ cacheRead: 700, cacheWrite: 50, serviceTier: "priority" });
  });

  it("出错的请求带错误信息；没有耗时为 null；子代理类型原样给", () => {
    const failed = readSessionTrace(dbPath, sessionFile).requests.find((request) => request.entryId === "m3")!;
    expect(failed).toMatchObject({
      stopReason: "error",
      errorMessage: "401 Authentication Fails",
      durationMs: null,
      ttftMs: null,
      agentType: "Alpha",
    });
  });

  it("没有这个会话的请求：空列表，库存在", () => {
    expect(readSessionTrace(dbPath, path.join(dir, "不存在.jsonl"))).toEqual({
      hasDatabase: true,
      requests: [],
      truncated: false,
    });
    expect(readSessionTrace(path.join(dir, "no.db"), sessionFile)).toEqual({
      hasDatabase: false,
      requests: [],
      truncated: false,
    });
  });

  it("超过 TRACE_LIMIT 条只留最近的，并标 truncated", () => {
    const big = path.join(dir, "big.jsonl");
    const db = new DatabaseSync(dbPath);
    db.exec("BEGIN");
    for (let index = 0; index < TRACE_LIMIT + 5; index++)
      insertMessage(db, { file: big, entry: `e${index}`, timestamp: 10_000 + index });
    db.exec("COMMIT");
    db.close();
    const trace = readSessionTrace(dbPath, big);
    expect(trace.requests).toHaveLength(TRACE_LIMIT);
    expect(trace.truncated).toBe(true);
    expect(trace.requests[0]!.entryId).toBe(`e${TRACE_LIMIT + 4}`);
    expect(trace.requests.at(-1)!.entryId).toBe("e5");
  });
});
