import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchQuota,
  parseQuota,
  parseResetCredits,
  readHeatmap,
  statsDbPath,
} from "../src/main/usage/usage-service.ts";
import { creditExpiry, isUntouched, quotaFetchedAt } from "../src/shared/ui/usage-summary.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 用量 "));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const noon = (daysAgo: number, now: number) => {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
};

describe("stats.db 位置", () => {
  const home = path.join(path.sep, "h");
  it("默认 <home>/.omp/stats.db，PI_CODING_AGENT_DIR 不影响（实测）", () => {
    expect(statsDbPath({}, home)).toBe(path.join(home, ".omp", "stats.db"));
    expect(statsDbPath({ PI_CODING_AGENT_DIR: path.join(home, "elsewhere") }, home)).toBe(
      path.join(home, ".omp", "stats.db"),
    );
  });
  it("PI_CONFIG_DIR 换配置根目录名；空串当没设", () => {
    expect(statsDbPath({ PI_CONFIG_DIR: ".cfgx" }, home)).toBe(path.join(home, ".cfgx", "stats.db"));
    expect(statsDbPath({ PI_CONFIG_DIR: "" }, home)).toBe(path.join(home, ".omp", "stats.db"));
  });
  it("命名 profile 在 profiles/<名>/；OMP_PROFILE 压过 PI_PROFILE（即使为空）；default 等于默认", () => {
    expect(statsDbPath({ OMP_PROFILE: "foo" }, home)).toBe(path.join(home, ".omp", "profiles", "foo", "stats.db"));
    expect(statsDbPath({ PI_PROFILE: "bar" }, home)).toBe(path.join(home, ".omp", "profiles", "bar", "stats.db"));
    expect(statsDbPath({ OMP_PROFILE: "", PI_PROFILE: "bar" }, home)).toBe(path.join(home, ".omp", "stats.db"));
    expect(statsDbPath({ OMP_PROFILE: "default" }, home)).toBe(path.join(home, ".omp", "stats.db"));
  });
});

describe("近一年每日消耗", () => {
  it("把 omp stats.db 的小时桶按本地日期合并，一年以前的不要，库不存在时说明没有库", () => {
    const now = new Date(2026, 9, 18, 15, 0).getTime();
    const dbPath = path.join(dir, "stats.db");
    const db = new DatabaseSync(dbPath);
    // 只建 readHeatmap 用到的列；omp 的真实表还有更多列（见 omp-usage.md）。
    db.exec("CREATE TABLE message_rollup (bucket INTEGER, requests INTEGER, total_tokens INTEGER, cost_total REAL)");
    const insert = db.prepare("INSERT INTO message_rollup VALUES (?, ?, ?, ?)");
    insert.run(noon(0, now), 2, 1000, 0.5);
    insert.run(noon(0, now) + 3_600_000, 1, 500, 0.25); // 同一天的另一个小时
    insert.run(noon(3, now), 4, 4000, 1);
    insert.run(noon(364, now), 1, 10, 0.01); // 窗口的第一天
    insert.run(noon(366, now), 9, 9, 9); // 窗口之外
    db.close();

    const heatmap = readHeatmap(dbPath, now);
    expect(heatmap.hasDatabase).toBe(true);
    expect(heatmap.days).toEqual([
      { date: "2025-10-19", requests: 1, tokens: 10, costUsd: 0.01 },
      { date: "2026-10-15", requests: 4, tokens: 4000, costUsd: 1 },
      { date: "2026-10-18", requests: 3, tokens: 1500, costUsd: 0.75 },
    ]);
    expect(heatmap.from).toBe("2025-10-19");
    expect(heatmap.to).toBe("2026-10-18");

    expect(readHeatmap(path.join(dir, "不存在.db"), now)).toMatchObject({ hasDatabase: false, days: [] });
  });
});

describe("订阅额度", () => {
  it("解析 omp usage --json 的报告：百分比单位、used/limit、剩余比例三种写法，认不出的条目跳过", () => {
    const quota = parseQuota({
      generatedAt: 1000,
      reports: [
        {
          provider: "anthropic",
          fetchedAt: 900,
          metadata: { email: "a@example.com" },
          notes: ["OMP-observed spend only", 3],
          limits: [
            {
              id: "5h",
              label: "5 Hour",
              scope: { provider: "anthropic" },
              window: { id: "5h", label: "5 Hour", resetsAt: 5000 },
              amount: { unit: "percent", used: 42 },
              status: "ok",
            },
            {
              id: "7d",
              label: "7 Day",
              scope: { provider: "anthropic" },
              amount: { unit: "requests", used: 5, limit: 10 },
            },
            {
              id: "m",
              label: "Monthly",
              scope: { provider: "anthropic" },
              amount: { unit: "unknown", remainingFraction: 0.25 },
              status: "warning",
            },
            "garbage",
          ],
        },
        { provider: "" },
        "garbage",
      ],
    });
    expect(quota.generatedAt).toBe(1000);
    expect(quota.accounts).toHaveLength(1);
    const [account] = quota.accounts;
    expect(account).toMatchObject({
      provider: "anthropic",
      account: "a@example.com",
      notes: ["OMP-observed spend only"],
    });
    expect(account?.limits.map((limit) => [limit.id, limit.usedFraction, limit.status])).toEqual([
      ["5h", 0.42, "ok"],
      ["7d", 0.5, "unknown"],
      ["m", 0.75, "warning"],
    ]);
    expect(account?.limits[0]?.resetsAt).toBe(5000);
  });

  it("没有登录账号时是空列表", () => {
    expect(parseQuota({ generatedAt: 1, reports: [], accountsWithoutUsage: [] }).accounts).toEqual([]);
  });
});

describe("omp 命令失败不被吞", () => {
  it("非 0 退出抛错并带 stderr 末尾；超时也抛错", async () => {
    const { requireSuccess, runOmpCommand, fetchQuota } = await import("../src/main/usage/usage-service.ts");
    expect(() => requireSuccess("omp stats", { code: 0, stderr: "" })).not.toThrow();
    expect(() => requireSuccess("omp stats", { code: 2, stderr: "a\nb\nlock busy\n" })).toThrow(/code 2.*lock busy/);
    await expect(fetchQuota(() => Promise.resolve({ code: 1, stdout: "", stderr: "no network" }))).rejects.toThrow(
      /omp usage exited with code 1: no network/,
    );
    // 真实子进程：node 睡 5 秒，超时 200ms。
    const run = runOmpCommand(process.execPath, os.tmpdir(), 200);
    await expect(run(["-e", "setTimeout(()=>{},5000)"])).rejects.toThrow(/timed out/);
    const failed = await runOmpCommand(
      process.execPath,
      os.tmpdir(),
      10_000,
    )(["-e", "console.error('boom');process.exit(3)"]);
    expect(failed).toMatchObject({ code: 3 });
    expect(failed.stderr).toContain("boom");
  });
});

describe("额度的套餐 / 重置券 / 取不到用量的账号（按 omp 源码类型写，没有订阅账号实测）", () => {
  const now = Date.parse("2026-10-23T00:00:00Z");
  const report = (extra: Record<string, unknown>) => ({
    provider: "openai-codex",
    fetchedAt: now - 180_000,
    limits: [],
    ...extra,
  });

  it("planType、daybreak 来自 metadata；没带时 null / false", () => {
    const quota = parseQuota(
      { reports: [report({ metadata: { planType: "pro", daybreak: true, email: "a@b.c" } }), report({})] },
      now,
    );
    expect(quota.accounts.map((account) => [account.planType, account.daybreak])).toEqual([
      ["pro", true],
      [null, false],
    ]);
  });

  it("重置券：攒的次数、现在能用几次、最近的到期时间；没攒（0 张）的不显示", () => {
    const credits = (extra: Record<string, unknown>) => ({ availableCount: 3, ...extra });
    expect(parseResetCredits(credits({ redeemableCount: 1 }), now)).toEqual({
      bankedCount: 3,
      redeemableCount: 1,
      soonestExpiryAt: null,
      unavailableReason: null,
    });
    expect(parseResetCredits({ availableCount: 0 }, now)).toBeNull();
    const expiry = parseResetCredits(
      credits({
        credits: [
          { expiresAt: "2026-10-30T00:00:00Z" },
          { expiresAt: "2026-10-25T00:00:00Z" },
          { expiresAt: "2026-10-01T00:00:00Z" }, // 已过期的不抢最近一张
          { expiresAt: "2026-10-24T00:00:00Z", status: "redeemed" }, // 已用掉的不算
          { expiresAt: "2026-10-24T12:00:00Z", remainingCount: 0 },
        ],
      }),
      now,
    );
    expect(expiry?.soonestExpiryAt).toBe(Date.parse("2026-10-25T00:00:00Z"));
    // 全过期了：取最近过期的那张。
    const lapsed = parseResetCredits(
      credits({ credits: [{ expiresAt: "2026-10-01T00:00:00Z" }, { expiresAt: "2026-10-10T00:00:00Z" }] }),
      now,
    );
    expect(lapsed?.soonestExpiryAt).toBe(Date.parse("2026-10-10T00:00:00Z"));
  });

  it("现在用不了的原因：provider 的 reason > 冷却 > 券被哪些额度挡住 > 券状态 > 没资格 > 有券但用不了", () => {
    const reason = (raw: Record<string, unknown>) =>
      parseResetCredits({ availableCount: 2, redeemableCount: 0, ...raw }, now)?.unavailableReason;
    expect(reason({ reason: "cooldown please" })).toBe("cooldown please");
    expect(reason({ cooldownUntil: "2026-10-24T00:00:00Z" })).toBe("cooldown until 2026-10-24T00:00:00Z");
    expect(reason({ credits: [{ blocking: ["anthropic:5h", "x"] }] })).toBe("blocked by anthropic:5h, x");
    expect(reason({ credits: [{ status: "expired" }] })).toBe("expired");
    expect(reason({ eligible: false })).toBe("not eligible");
    expect(reason({})).toBe("not usable right now");
    expect(parseResetCredits({ availableCount: 2 }, now)?.unavailableReason).toBeNull();
  });

  it("accountsWithoutUsage：按 omp 的取名规则写 label（邮箱 > 账号 id > 项目 > 企业地址 > OAuth account；API key；带组织名）", () => {
    const quota = parseQuota(
      {
        reports: [],
        accountsWithoutUsage: [
          { provider: "anthropic", type: "oauth", email: "a@b.c" },
          { provider: "google", type: "oauth", accountId: "acc-1", orgName: "Org" },
          { provider: "github", type: "oauth", projectId: "p1" },
          { provider: "copilot", type: "oauth", enterpriseUrl: "https://ghe.example" },
          { provider: "kimi", type: "oauth" },
          { provider: "openai", type: "api_key" },
          { provider: "" },
        ],
      },
      now,
    );
    expect(quota.unavailable.map((item) => `${item.provider}: ${item.label}`)).toEqual([
      "anthropic: a@b.c",
      "google: acc-1 · Org",
      "github: p1",
      "copilot: https://ghe.example",
      "kimi: OAuth account",
      "openai: API key",
    ]);
  });

  it("有重置券或 Daybreak 的账号不算“未使用”；quotaFetchedAt 取最晚的取数时间", () => {
    const quota = parseQuota(
      {
        reports: [
          report({ resetCredits: { availableCount: 1 }, fetchedAt: now - 60_000 }),
          report({ metadata: { daybreak: true }, fetchedAt: now - 10_000 }),
          report({ fetchedAt: now - 300_000 }),
        ],
      },
      now,
    );
    expect(quota.accounts.map(isUntouched)).toEqual([false, false, true]);
    expect(quotaFetchedAt(quota.accounts)).toBe(now - 10_000);
    expect(quotaFetchedAt([])).toBeNull();
  });

  it("creditExpiry：分 / 时 / 天取整，已到期是 null", () => {
    expect(creditExpiry(now + 90 * 60_000, now)).toEqual({ value: 2, unit: "hour" });
    expect(creditExpiry(now + 5 * 60_000, now)).toEqual({ value: 5, unit: "minute" });
    expect(creditExpiry(now + 3 * 86_400_000, now)).toEqual({ value: 3, unit: "day" });
    expect(creditExpiry(now - 1, now)).toBeNull();
  });
});

describe("刷新额度绕过 omp 的缓存", () => {
  const ok = { code: 0, stderr: "", stdout: JSON.stringify({ generatedAt: 1, reports: [] }) };

  it("refresh 先 omp usage invalidate 再取；不 refresh 只取（读缓存）", async () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return Promise.resolve(ok);
    };
    await fetchQuota(run);
    expect(calls).toEqual([["usage", "--json"]]);
    calls.length = 0;
    await fetchQuota(run, true);
    expect(calls).toEqual([
      ["usage", "invalidate"],
      ["usage", "--json"],
    ]);
  });

  it("invalidate 失败就报错，不拿缓存的旧数据冒充刷新过", async () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return Promise.resolve(args[1] === "invalidate" ? { code: 1, stdout: "", stderr: "locked" } : ok);
    };
    await expect(fetchQuota(run, true)).rejects.toThrow(/omp usage invalidate exited with code 1: locked/);
    expect(calls).toEqual([["usage", "invalidate"]]);
  });
});

describe("热力图读 stats.db 前的表结构自检", () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();

  it("message_rollup 缺列：报明确错误，不是一页空白", () => {
    const dbPath = path.join(dir, "缺列.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE message_rollup (bucket INTEGER, requests INTEGER, total_tokens INTEGER)"); // 没有 cost_total
    db.close();
    expect(() => readHeatmap(dbPath, now)).toThrow(/schema mismatch: table message_rollup has no column cost_total/);
  });

  it("message_rollup 不存在：报明确错误", () => {
    const dbPath = path.join(dir, "缺表.db");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE other (x INTEGER)");
    db.close();
    expect(() => readHeatmap(dbPath, now)).toThrow(/schema mismatch: table message_rollup is missing/);
  });
});
