// 用量数据（只读）：订阅账号额度 + 近一年每日消耗。数据来源和取舍见 docs/architecture/omp-usage.md。
//   额度：`omp usage --json`（omp 自己去各 provider 查，带缓存；没有登录账号时 reports 为空）。
//   每日消耗：omp 的 `stats.db`（`message_rollup`，小时桶）。这个库**只有 `omp stats` 运行时才会同步新会话**，
//   所以"刷新"= 先让 omp 自己跑一次 `omp stats --json`（它负责读会话文件、加锁、写库），再用 node:sqlite 只读地查。
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runCommand } from "../git/exec.ts";
import { isRecord } from "../../shared/type-guards.ts";
import type { QuotaAccount, QuotaLimit, QuotaSnapshot, UsageDay, UsageHeatmap } from "../../shared/ipc.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const heatmapDays = 365;

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 和 omp 的 resolveUsedFraction 同一个优先级：显式比例 > used/limit > percent 单位 > 1 - 剩余比例。 */
function usedFraction(amount: Record<string, unknown>): number | null {
  const explicit = num(amount["usedFraction"]);
  if (explicit !== null) return explicit;
  const used = num(amount["used"]);
  const limit = num(amount["limit"]);
  if (used !== null && limit !== null && limit > 0) return used / limit;
  if (amount["unit"] === "percent" && used !== null) return used / 100;
  const remaining = num(amount["remainingFraction"]);
  return remaining === null ? null : Math.max(0, 1 - remaining);
}

function parseLimit(raw: unknown): QuotaLimit | null {
  if (!isRecord(raw)) return null;
  const window = isRecord(raw["window"]) ? raw["window"] : {};
  const amount = isRecord(raw["amount"]) ? raw["amount"] : {};
  const status = raw["status"];
  return {
    id: str(raw["id"]) ?? "",
    label: str(raw["label"]) ?? str(window["label"]) ?? "",
    windowLabel: str(window["label"]),
    usedFraction: usedFraction(amount),
    resetsAt: num(window["resetsAt"]),
    status: status === "ok" || status === "warning" || status === "exhausted" ? status : "unknown",
  };
}

/** `omp usage --json` → 按（provider, 账号）分组的额度。结构不认识的条目跳过，不抛错。 */
export function parseQuota(json: unknown): QuotaSnapshot {
  const root = isRecord(json) ? json : {};
  const accounts: QuotaAccount[] = [];
  for (const report of list(root["reports"])) {
    if (!isRecord(report)) continue;
    const provider = str(report["provider"]);
    if (!provider) continue;
    const metadata = isRecord(report["metadata"]) ? report["metadata"] : {};
    const rawLimits = list(report["limits"]);
    const firstLimit = rawLimits[0];
    const scope = isRecord(firstLimit) && isRecord(firstLimit["scope"]) ? firstLimit["scope"] : {};
    accounts.push({
      provider,
      account: str(metadata["email"]) ?? str(scope["accountId"]) ?? str(metadata["accountId"]),
      limits: rawLimits.map(parseLimit).filter((limit): limit is QuotaLimit => limit !== null),
      notes: list(report["notes"]).filter((note): note is string => typeof note === "string"),
      fetchedAt: num(report["fetchedAt"]),
    });
  }
  return { generatedAt: num(root["generatedAt"]) ?? Date.now(), accounts };
}

function localDate(ms: number): string {
  const date = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * omp 的 stats.db 位置（实测，见 omp-usage.md）：`<home>/<PI_CONFIG_DIR 或 .omp>/[profiles/<profile>/]stats.db`。
 * `PI_CODING_AGENT_DIR` 不影响它。home / env 取启动 omp 子进程时用的同一份（子进程继承 process.env），
 * 所以把 USERPROFILE/HOME 指到临时目录的隔离启动不会读到真实 ~/.omp。
 * profile：`OMP_PROFILE` 优先（即使为空串也压过 `PI_PROFILE`）；空串和 `default` 都是默认 profile。
 */
export function statsDbPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const configDir = env["PI_CONFIG_DIR"];
  const root =
    configDir !== undefined && configDir !== ""
      ? path.isAbsolute(configDir)
        ? configDir
        : path.join(home, configDir)
      : path.join(home, ".omp");
  const profile = env["OMP_PROFILE"] ?? env["PI_PROFILE"] ?? "";
  return profile === "" || profile === "default"
    ? path.join(root, "stats.db")
    : path.join(root, "profiles", profile, "stats.db");
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

export type RunOmp = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** omp 命令以非 0 退出：message 带 stderr 末尾一段，界面经 describeError 显示。 */
export class OmpCommandError extends Error {
  override name = "OmpCommandError";
}

/**
 * `omp <args>` 取全部 stdout；用参数数组，不走 shell。env 带上 omp-studio 存的 API key（额度查询要用）。
 * 超时（runCommand 杀进程后抛错）和输出过大照原样抛出，不吞。
 */
export function runOmpCommand(
  exePath: string,
  cwd: string,
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
): RunOmp {
  return async (args) => {
    const result = await runCommand(exePath, args, {
      cwd,
      env: { ...process.env, ...extraEnv, NO_COLOR: "1", FORCE_COLOR: "0" },
      timeoutMs,
    });
    return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr };
  };
}

function stderrTail(stderr: string): string {
  return stderr.trim().split(/\r?\n/).slice(-3).join(" | ").slice(-400);
}

/** 退出码非 0 就抛，带 stderr 末尾。 */
export function requireSuccess(what: string, result: { code: number; stderr: string }): void {
  if (result.code === 0) return;
  const tail = stderrTail(result.stderr);
  throw new OmpCommandError(`${what} exited with code ${result.code}${tail ? `: ${tail}` : ""}`);
}

export async function fetchQuota(run: RunOmp): Promise<QuotaSnapshot> {
  const result = await run(["usage", "--json"]);
  requireSuccess("omp usage", result);
  return parseQuota(JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))));
}
