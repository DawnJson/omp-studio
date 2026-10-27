// 新任务页"本周用量"卡片的数据（纯函数，可单测）：近 7 天的 token / 费用合计、今天的 token、点阵每天一列的高度。
// "今天"取热力图的 to（主进程按本地时区算好的最后一天），不在渲染进程另取时钟。
import type { UsageHeatmap } from "../../../../shared/ipc.ts";

/** 点阵画几周（每天一列）。 */
export const OVERVIEW_WEEKS = 12;
/** 一列最多几个点。 */
export const MAX_DOTS = 6;
const RECENT_DAYS = 7;

export interface UsageColumn {
  /** YYYY-MM-DD */
  date: string;
  tokens: number;
  /** 亮几个点：0 = 没用量；有用量至少 1 个，最多的那天 MAX_DOTS 个。 */
  dots: number;
  /** 属于最近 7 天（含今天）。 */
  recent: boolean;
}

export interface UsageOverview {
  weekTokens: number;
  weekCost: number;
  todayTokens: number;
  /** 从旧到新，OVERVIEW_WEEKS × 7 列，最后一列是今天。 */
  columns: UsageColumn[];
}

function parseDate(text: string): Date {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** 本地时区的 YYYY-MM-DD（和热力图的日期同一写法）。 */
export function localDateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 一天亮几个点：按最多那天等比，四舍五入；有用量的日子至少 1 个点，不和没用量的日子混在一起。 */
export function dotCount(tokens: number, max: number, maxDots = MAX_DOTS): number {
  if (tokens <= 0 || max <= 0) return 0;
  return Math.min(maxDots, Math.max(1, Math.round((tokens / max) * maxDots)));
}

export function usageOverview(heatmap: Pick<UsageHeatmap, "to" | "days">): UsageOverview {
  const byDate = new Map(heatmap.days.map((day) => [day.date, day]));
  const total = OVERVIEW_WEEKS * 7;
  const cursor = parseDate(heatmap.to);
  cursor.setDate(cursor.getDate() - (total - 1));
  const days: { date: string; tokens: number; costUsd: number; recent: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const date = localDateText(cursor);
    const day = byDate.get(date);
    days.push({ date, tokens: day?.tokens ?? 0, costUsd: day?.costUsd ?? 0, recent: i >= total - RECENT_DAYS });
    cursor.setDate(cursor.getDate() + 1);
  }
  const max = Math.max(0, ...days.map((day) => day.tokens));
  const week = days.filter((day) => day.recent);
  return {
    weekTokens: week.reduce((sum, day) => sum + day.tokens, 0),
    weekCost: week.reduce((sum, day) => sum + day.costUsd, 0),
    todayTokens: days[total - 1]?.tokens ?? 0,
    columns: days.map(({ date, tokens, recent }) => ({ date, tokens, dots: dotCount(tokens, max), recent })),
  };
}
