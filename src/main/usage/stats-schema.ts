// omp 的 stats.db 不是公开契约（表名、列名随 omp 版本变）。studio 直读它的地方（热力图、会话信息、请求记录）先自检要用的表和列：
// 缺了就抛 StatsSchemaError，界面显示"统计库结构对不上"，而不是查出空结果、画一页空白。
import type { DatabaseSync } from "node:sqlite";

/** 错误文字里的固定开头：shared/ui/errors.ts 按它认出这类错误并翻译。 */
export const STATS_SCHEMA_ERROR_PREFIX = "omp stats.db schema mismatch";

export class StatsSchemaError extends Error {
  override name = "StatsSchemaError";
}

/** 每张表 studio 读到的列（名字照 omp 18.12.6 实测的真实库）。 */
export const STATS_TABLES = {
  message_rollup: ["bucket", "requests", "total_tokens", "cost_total"],
  messages: [
    "id",
    "session_file",
    "entry_id",
    "model",
    "provider",
    "timestamp",
    "duration",
    "ttft",
    "stop_reason",
    "error_message",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "total_tokens",
    "cost_total",
    "agent_type",
    "service_tier",
  ],
  tool_calls: ["id", "session_file", "entry_id", "tool_name", "is_error", "args_chars", "result_chars"],
} as const;

type StatsTable = keyof typeof STATS_TABLES;

/** 确认 `tables` 都存在、列齐全；不齐就抛 StatsSchemaError，写明缺哪些。 */
export function requireStatsSchema(db: DatabaseSync, tables: readonly StatsTable[]): void {
  const problems: string[] = [];
  for (const table of tables) {
    // PRAGMA 不支持参数绑定；table 来自上面的固定集合。表不存在时返回空列表。
    const present = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name?: unknown }[]).map((row) => String(row.name)),
    );
    if (present.size === 0) {
      problems.push(`table ${table} is missing`);
      continue;
    }
    const missing = STATS_TABLES[table].filter((column) => !present.has(column));
    if (missing.length > 0) problems.push(`table ${table} has no column ${missing.join(", ")}`);
  }
  if (problems.length > 0) throw new StatsSchemaError(`${STATS_SCHEMA_ERROR_PREFIX}: ${problems.join("; ")}`);
}
