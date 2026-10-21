// 会话信息和请求记录的数据：只读 omp 的 `stats.db`（node:sqlite，WAL，读方短暂等待）。位置和"只在 `omp stats` 运行时才同步"见
// docs/architecture/omp-usage.md（usage-service.statsDbPath）。表（omp 18.12.5 实测）：
//   session_rollup(session_file PK, requests, started_at, ended_at, total_tokens, cost_total, unpriced, models, tool_calls)
//   messages(session_file, entry_id, model, provider, timestamp, duration, ttft, stop_reason, error_message, *_tokens, cost_total, agent_type, service_tier …)
//   tool_calls(session_file, entry_id, tool_call_id, tool_name, args_chars, result_chars, is_error …)
// `session_file` 存的是 omp 当时报告的路径原文（Windows 上是反斜杠绝对路径）：先按 path.resolve 后的原样精确匹配，
// Windows 上没命中再不分大小写、不分斜杠方向匹配（任务记录里的路径写法可能和 omp 写库时不同）。
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SessionRollup, SessionTrace, TaskSessionInfo, TraceRequest, TraceToolCall } from "../../shared/ipc.ts";

/** 请求记录最多返回多少条（最近的）；再早的 truncated = true。 */
export const TRACE_LIMIT = 500;

type Row = Record<string, unknown>;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function open(dbPath: string): DatabaseSync {
  // stats.db 是 WAL；omp 同步写入时读方短暂等待而不是直接 BUSY。
  return new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
}

/** 库里这个会话的 session_file 键：精确匹配优先；Windows 上再回退到不分大小写、不分斜杠的匹配。 */
function resolveKey(db: DatabaseSync, table: "session_rollup" | "messages", sessionFile: string): string | null {
  const exact = path.resolve(sessionFile);
  const hit = (value: string) =>
    db.prepare(`SELECT session_file FROM ${table} WHERE session_file = ? LIMIT 1`).get(value) as Row | undefined;
  const found = hit(exact) ?? (exact === sessionFile ? undefined : hit(sessionFile));
  if (found !== undefined) return text(found["session_file"]);
  if (process.platform !== "win32") return null;
  const fuzzy = db
    .prepare(`SELECT session_file FROM ${table} WHERE lower(replace(session_file, '/', '\\')) = ? LIMIT 1`)
    .get(exact.replaceAll("/", "\\").toLowerCase()) as Row | undefined;
  return fuzzy === undefined ? null : text(fuzzy["session_file"]);
}

function toRollup(row: Row): SessionRollup {
  return {
    requests: num(row["requests"]),
    startedAt: num(row["started_at"]),
    endedAt: num(row["ended_at"]),
    totalTokens: num(row["total_tokens"]),
    costUsd: num(row["cost_total"]),
    unpriced: num(row["unpriced"]),
    models: text(row["models"])
      .split(",")
      .map((model) => model.trim())
      .filter((model) => model !== ""),
    toolCalls: num(row["tool_calls"]),
  };
}

/** `session_rollup` 的汇总行加 messages 的 token 分项；库不存在时 hasDatabase 为 false。 */
export function readSessionStats(dbPath: string, sessionFile: string): TaskSessionInfo["stats"] {
  if (!existsSync(dbPath)) return { hasDatabase: false, rollup: null, tokens: null };
  const db = open(dbPath);
  try {
    const rollupKey = resolveKey(db, "session_rollup", sessionFile);
    const rollupRow =
      rollupKey === null
        ? undefined
        : (db.prepare("SELECT * FROM session_rollup WHERE session_file = ?").get(rollupKey) as Row | undefined);
    const messagesKey = resolveKey(db, "messages", sessionFile);
    const tokenRow =
      messagesKey === null
        ? undefined
        : (db
            .prepare(
              `SELECT COUNT(*) AS n, TOTAL(input_tokens) AS input, TOTAL(output_tokens) AS output,
                      TOTAL(cache_read_tokens) AS cache_read, TOTAL(cache_write_tokens) AS cache_write
               FROM messages WHERE session_file = ?`,
            )
            .get(messagesKey) as Row | undefined);
    return {
      hasDatabase: true,
      rollup: rollupRow === undefined ? null : toRollup(rollupRow),
      tokens:
        tokenRow === undefined || num(tokenRow["n"]) === 0
          ? null
          : {
              input: num(tokenRow["input"]),
              output: num(tokenRow["output"]),
              cacheRead: num(tokenRow["cache_read"]),
              cacheWrite: num(tokenRow["cache_write"]),
            },
    };
  } finally {
    db.close();
  }
}

/** 请求记录：这个会话最近 TRACE_LIMIT 条模型请求（从新到旧），每条带它发起的工具调用。 */
export function readSessionTrace(dbPath: string, sessionFile: string): SessionTrace {
  if (!existsSync(dbPath)) return { hasDatabase: false, requests: [], truncated: false };
  const db = open(dbPath);
  try {
    const key = resolveKey(db, "messages", sessionFile);
    if (key === null) return { hasDatabase: true, requests: [], truncated: false };
    const params: SQLInputValue[] = [key, TRACE_LIMIT + 1];
    const rows = db
      .prepare("SELECT * FROM messages WHERE session_file = ? ORDER BY timestamp DESC, id DESC LIMIT ?")
      .all(...params) as Row[];
    const truncated = rows.length > TRACE_LIMIT;
    const kept = truncated ? rows.slice(0, TRACE_LIMIT) : rows;
    const toolRows = db
      .prepare(
        "SELECT entry_id, tool_name, is_error, args_chars, result_chars FROM tool_calls WHERE session_file = ? ORDER BY id",
      )
      .all(key) as Row[];
    const toolsByEntry = new Map<string, TraceToolCall[]>();
    for (const row of toolRows) {
      const entry = text(row["entry_id"]);
      const list = toolsByEntry.get(entry) ?? [];
      list.push({
        name: text(row["tool_name"]),
        isError: row["is_error"] === null || row["is_error"] === undefined ? null : num(row["is_error"]) !== 0,
        argsChars: num(row["args_chars"]),
        resultChars: numOrNull(row["result_chars"]),
      });
      toolsByEntry.set(entry, list);
    }
    const requests: TraceRequest[] = kept.map((row) => ({
      entryId: text(row["entry_id"]),
      timestamp: num(row["timestamp"]),
      model: text(row["model"]),
      provider: text(row["provider"]),
      agentType: text(row["agent_type"]) || "main",
      stopReason: text(row["stop_reason"]),
      errorMessage: textOrNull(row["error_message"]),
      input: num(row["input_tokens"]),
      output: num(row["output_tokens"]),
      cacheRead: num(row["cache_read_tokens"]),
      cacheWrite: num(row["cache_write_tokens"]),
      total: num(row["total_tokens"]),
      costUsd: num(row["cost_total"]),
      durationMs: numOrNull(row["duration"]),
      ttftMs: numOrNull(row["ttft"]),
      serviceTier: textOrNull(row["service_tier"]),
      tools: toolsByEntry.get(text(row["entry_id"])) ?? [],
    }));
    return { hasDatabase: true, requests, truncated };
  } finally {
    db.close();
  }
}
