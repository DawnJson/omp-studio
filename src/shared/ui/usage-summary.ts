// 用量页的汇总：全部是纯函数，可单测。日期都是 YYYY-MM-DD（本机日历日），不碰时区。
import type { QuotaAccount, QuotaLimit, UsageDay, UsageHeatmap } from "../ipc.ts";

const dayMs = 24 * 60 * 60 * 1000;
/** "最近 30 天"含 to 当天。 */
const recentDays = 30;

/** YYYY-MM-DD 转成当天 0 点的 UTC 毫秒，只用来数天数（不受夏令时影响）。 */
function dayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / dayMs;
}

/** 当天有没有用过（请求、token、花费任一不为 0）。 */
function isActiveDay(day: UsageDay): boolean {
  return day.requests > 0 || day.tokens > 0 || day.costUsd > 0;
}

export interface ActivityStats {
  activeDays: number;
  /** 最长连续有记录的天数（按日历日算，中间隔一天就断，跨年照样连）。 */
  longestStreak: number;
}

export function activityStats(days: readonly UsageDay[]): ActivityStats {
  const active = [...new Set(days.filter(isActiveDay).map((day) => dayIndex(day.date)))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const index of active) {
    run = index === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = index;
  }
  return { activeDays: active.length, longestStreak: longest };
}

interface UsageTotals {
  costUsd: number;
  requests: number;
}

export interface UsageSummary {
  /** 整个窗口（一年）的合计。 */
  pastYear: UsageTotals;
  /** to 往前 30 天（含 to）的合计。 */
  last30: UsageTotals;
  /** last30 里每天的花费，旧到新，固定 30 项（没记录的天是 0），画迷你柱状图。 */
  spark: number[];
  /** 花费最高的一天；全是 0 花费时取请求最多的一天；没有记录时 null。 */
  busiest: UsageDay | null;
  activeDays: number;
  longestStreak: number;
}

export function summarizeUsage(heatmap: UsageHeatmap): UsageSummary {
  const totals = (days: readonly UsageDay[]): UsageTotals => ({
    costUsd: days.reduce((sum, day) => sum + day.costUsd, 0),
    requests: days.reduce((sum, day) => sum + day.requests, 0),
  });
  const end = dayIndex(heatmap.to);
  const start = end - (recentDays - 1);
  const recent = heatmap.days.filter((day) => {
    const index = dayIndex(day.date);
    return index >= start && index <= end;
  });
  const byIndex = new Map(recent.map((day) => [dayIndex(day.date), day.costUsd]));
  const spark = Array.from({ length: recentDays }, (_, i) => byIndex.get(start + i) ?? 0);
  let busiest: UsageDay | null = null;
  for (const day of heatmap.days) {
    if (!isActiveDay(day)) continue;
    if (
      busiest === null ||
      day.costUsd > busiest.costUsd ||
      (day.costUsd === busiest.costUsd && day.requests > busiest.requests)
    ) {
      busiest = day;
    }
  }
  return {
    pastYear: totals(heatmap.days),
    last30: totals(recent),
    spark,
    busiest,
    ...activityStats(heatmap.days),
  };
}

/** 用得最满的那个窗口（跳过没给比例的）；一个都没有时 null。并列取先出现的。 */
export function tightestQuota(
  accounts: readonly QuotaAccount[],
): { account: QuotaAccount; limit: QuotaLimit; usedFraction: number } | null {
  let best: { account: QuotaAccount; limit: QuotaLimit; usedFraction: number } | null = null;
  for (const account of accounts) {
    for (const limit of account.limits) {
      if (limit.usedFraction === null) continue;
      if (best === null || limit.usedFraction > best.usedFraction) {
        best = { account, limit, usedFraction: limit.usedFraction };
      }
    }
  }
  return best;
}

/** 账号的所有窗口都没用过（比例是 0 或没给），也没有攒着的重置券、不是 Daybreak 账号（omp 的 `idle` 同口径）：只在一行里列名字，不占整块。 */
export function isUntouched(account: QuotaAccount): boolean {
  return (
    account.resetCredits === null &&
    !account.daybreak &&
    account.limits.every((limit) => (limit.usedFraction ?? 0) <= 0 && limit.status !== "exhausted")
  );
}

/** omp 取到这批额度的时间（各账号 fetchedAt 里最晚的，毫秒）；一个都没带时 null。omp 有缓存，比"刚读"早时说明数据是缓存的。 */
export function quotaFetchedAt(accounts: readonly QuotaAccount[]): number | null {
  const times = accounts.flatMap((account) => (account.fetchedAt === null ? [] : [account.fetchedAt]));
  return times.length === 0 ? null : Math.max(...times);
}

/** 距离到期还有多久（取整到分 / 时 / 天）；已到期返回 null。给 Intl.RelativeTimeFormat 用。 */
export function creditExpiry(
  expiresAt: number,
  now: number,
): { value: number; unit: "minute" | "hour" | "day" } | null {
  const ms = expiresAt - now;
  if (ms <= 0) return null;
  if (ms < 3_600_000) return { value: Math.max(1, Math.round(ms / 60_000)), unit: "minute" };
  if (ms < 86_400_000) return { value: Math.round(ms / 3_600_000), unit: "hour" };
  return { value: Math.round(ms / 86_400_000), unit: "day" };
}

/** 剩余百分比（0..100 的整数）；没给比例时 null。 */
export function leftPercent(limit: QuotaLimit): number | null {
  if (limit.status === "exhausted") return 0;
  if (limit.usedFraction === null) return null;
  return Math.max(0, Math.min(100, Math.round((1 - limit.usedFraction) * 100)));
}
