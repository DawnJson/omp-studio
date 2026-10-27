// 近一年每日消耗：只读 omp 的 `stats.db`（`message_rollup`，小时桶）。数据来源和"只有 `omp stats` 运行时才同步"见
// docs/architecture/omp-usage.md。在 SQLite worker 里跑（usage/db-worker.ts），不阻塞主进程；这里不 import electron、不碰主进程状态。
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { UsageDay, UsageHeatmap } from "../../shared/ipc.ts";
import { requireStatsSchema } from "./stats-schema.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const heatmapDays = 365;

function localDate(ms: number): string {
  const date = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

interface RollupRow {
  bucket: number;
  requests: number;
  tokens: number;
  cost: number;
}

/** 近 365 天（含今天，本地时区）每天的请求数、token、花费；没有数据的日子不出现。库不存在时 hasDatabase 为 false。 */
export function readHeatmap(dbPath: string, now: number = Date.now()): UsageHeatmap {
  const first = new Date(now);
  first.setDate(first.getDate() - (heatmapDays - 1));
  first.setHours(0, 0, 0, 0);
  const from = localDate(first.getTime());
  const to = localDate(now);
  if (!existsSync(dbPath)) return { from, to, days: [], hasDatabase: false };
  // stats.db 是 WAL；omp 同步写入时读方短暂等待而不是直接 BUSY。
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    requireStatsSchema(db, ["message_rollup"]);
    // 小时桶按 UTC 对齐；多取一天，让本地时区的第一天不缺头。
    const rows = db
      .prepare(
        "SELECT bucket, SUM(requests) AS requests, SUM(total_tokens) AS tokens, TOTAL(cost_total) AS cost FROM message_rollup WHERE bucket >= ? GROUP BY bucket",
      )
      .all(first.getTime() - DAY_MS);
    const byDay = new Map<string, UsageDay>();
    // node:sqlite 的 .all() 返回行对象，列名和上面的别名一一对应。
    for (const row of rows as unknown as RollupRow[]) {
      const date = localDate(row.bucket);
      if (date < from) continue;
      const day = byDay.get(date) ?? { date, requests: 0, tokens: 0, costUsd: 0 };
      day.requests += row.requests;
      day.tokens += row.tokens;
      day.costUsd += row.cost;
      byDay.set(date, day);
    }
    return { from, to, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), hasDatabase: true };
  } finally {
    db.close();
  }
}
