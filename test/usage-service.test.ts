import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseQuota, readHeatmap } from "../src/main/usage/usage-service.ts";

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
