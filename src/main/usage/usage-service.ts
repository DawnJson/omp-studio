// 用量数据（只读）：订阅账号额度 + 近一年每日消耗。数据来源和取舍见 docs/architecture/omp-usage.md。
//   额度：`omp usage --json`（omp 自己去各 provider 查，带缓存；没有登录账号时 reports 为空）。
//   每日消耗：omp 的 `stats.db`（`message_rollup`，小时桶）。这个库**只有 `omp stats` 运行时才会同步新会话**，
//   所以"刷新"= 先让 omp 自己跑一次 `omp stats --json`（它负责读会话文件、加锁、写库），再用 node:sqlite 只读地查（heatmap.ts，在 worker 里跑）。
import os from "node:os";
import path from "node:path";
import { runCommand } from "../git/exec.ts";
import { finiteNumber as num, isRecord, nonEmptyString as str } from "../../shared/type-guards.ts";
import type { QuotaAccount, QuotaLimit, QuotaResetCredits, QuotaSnapshot, QuotaUnavailable } from "../../shared/ipc.ts";

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

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

/**
 * 重置券（`resetCredits`）：照 omp `usage-display.ts` 的 `nM`。最近一张还没过期的到期时间；都过期了取最近过期的那张。
 * 不可用的原因：provider 给的 reason > 冷却到 > 第一张可用券被哪些额度挡住 > 券状态 > 不符合资格 > "有券但现在用不了"。
 * `usage-dashboard.ts:648-667` 画成"N resets banked"徽章，悬停带"M usable now · expires in …"。
 */
export function parseResetCredits(raw: unknown, now: number): QuotaResetCredits | null {
  if (!isRecord(raw)) return null;
  const banked = Math.max(0, Math.trunc(num(raw["availableCount"]) ?? 0));
  if (banked === 0) return null;
  const redeemable = Math.max(0, Math.trunc(num(raw["redeemableCount"]) ?? banked));
  const credits = list(raw["credits"]).filter(isRecord);
  let upcoming: number | null = null;
  let lapsed: number | null = null;
  for (const credit of credits) {
    const expires = str(credit["expiresAt"]);
    if (expires === null || credit["remainingCount"] === 0 || credit["status"] === "redeemed") continue;
    const at = Date.parse(expires);
    if (!Number.isFinite(at)) continue;
    if (at > now) upcoming = upcoming === null ? at : Math.min(upcoming, at);
    else lapsed = lapsed === null ? at : Math.max(lapsed, at);
  }
  const nextId = str(raw["nextCreditId"]);
  const next =
    nextId !== null
      ? credits.find((credit) => credit["id"] === nextId)
      : (credits.find((credit) => credit["usable"] !== false) ?? credits[0]);
  const blocking =
    next !== undefined ? list(next["blocking"]).filter((item): item is string => typeof item === "string") : [];
  const cooldown = str(raw["cooldownUntil"]);
  const nextStatus = next !== undefined ? str(next["status"]) : null;
  const reason =
    str(raw["reason"]) ??
    (cooldown !== null ? `cooldown until ${cooldown}` : null) ??
    (blocking.length > 0 ? `blocked by ${blocking.join(", ")}` : null) ??
    (nextStatus !== null && nextStatus !== "available" ? nextStatus : null) ??
    (raw["eligible"] === false ? "not eligible" : null) ??
    (banked > 0 && redeemable === 0 ? "not usable right now" : null);
  return {
    bankedCount: banked,
    redeemableCount: redeemable,
    soonestExpiryAt: upcoming ?? lapsed,
    unavailableReason: reason,
  };
}

/**
 * `omp usage --json` → 按（provider, 账号）分组的额度。结构不认识的条目跳过，不抛错。
 * 字段来源：packages/ai/src/usage.ts 的 UsageReport 类型和 `omp usage --json` 的源码（packages/coding-agent/src/cli/usage-cli.ts）；
 * `planType`：openai-codex 和内置账号插件（`client-accounts/extension/adapter.mjs` 的 `usageReport`）在 metadata 里带，别的 provider 为 null；
 * `planEndsAt`（套餐到期 / 续费时间，毫秒）、`autoRenew` 只有内置账号插件带，是 studio 自己约定的字段，omp 不认也不显示。
 * `daybreak` = `metadata.daybreak === true`。resetCredits / planType / daybreak 没有订阅账号实测过 [推测：按源码类型写]。
 */
export function parseQuota(json: unknown, now: number = Date.now()): QuotaSnapshot {
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
      planType: str(metadata["planType"]),
      planEndsAt: num(metadata["planEndsAt"]),
      autoRenew: typeof metadata["autoRenew"] === "boolean" ? metadata["autoRenew"] : null,
      daybreak: metadata["daybreak"] === true,
      resetCredits: parseResetCredits(report["resetCredits"], now),
    });
  }
  // 登录了、但 omp 没能取到用量的账号（`accountsWithoutUsage`）：omp 的面板写 "<账号>: usage unavailable"（`LNe` 的取名规则）。
  const unavailable: QuotaUnavailable[] = [];
  for (const entry of list(root["accountsWithoutUsage"])) {
    if (!isRecord(entry)) continue;
    const provider = str(entry["provider"]);
    if (!provider) continue;
    const base =
      entry["type"] === "api_key"
        ? "API key"
        : (str(entry["email"]) ??
          str(entry["accountId"]) ??
          str(entry["projectId"]) ??
          str(entry["enterpriseUrl"]) ??
          "OAuth account");
    const org = str(entry["orgName"]) ?? str(entry["orgId"]);
    unavailable.push({ provider, label: org === null || org === base ? base : `${base} · ${org}` });
  }
  return { generatedAt: num(root["generatedAt"]) ?? now, accounts, unavailable };
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

export type RunOmp = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** omp 命令以非 0 退出：message 带 stderr 末尾一段，界面经 describeError 显示。 */
class OmpCommandError extends Error {
  override name = "OmpCommandError";
}

/**
 * `omp <args>` 取全部 stdout；用参数数组，不走 shell。
 * 超时（runCommand 杀进程后抛错）和输出过大照原样抛出，不吞。
 */
export function runOmpCommand(exePath: string, cwd: string, timeoutMs: number): RunOmp {
  return async (args) => {
    const result = await runCommand(exePath, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
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

/**
 * 读额度。omp 把各 provider 的用量报告缓存在 agent.db（约 5 分钟，`UsageCache`），`omp usage --json` 在缓存期内直接返回旧报告；
 * `refresh` = 先 `omp usage invalidate`（清全部 provider 的缓存，`usage-cli.ts` 的 invalidate 分支）再取，拿到的是此刻各 provider 的数据。
 */
export async function fetchQuota(run: RunOmp, refresh = false): Promise<QuotaSnapshot> {
  if (refresh) requireSuccess("omp usage invalidate", await run(["usage", "invalidate"]));
  const result = await run(["usage", "--json"]);
  requireSuccess("omp usage", result);
  return parseQuota(JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))));
}
