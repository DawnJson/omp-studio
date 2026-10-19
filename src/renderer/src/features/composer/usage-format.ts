// 数字的紧凑显示：上下文窗口、token 数、价格。K / M 不分语言，和 omp 终端里的写法一致。

/** 12_345 → "12.3K"，1_000_000 → "1M"；小于 1000 原样。 */
export function formatCount(value: number): string {
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return String(Math.round(value));
}

/** 美元金额。会话累计费用常常只有几分之一美分，0 < 金额 < 0.01 时保留 4 位小数，不然全是 $0.00；正好 0 写 $0.00。 */
export function formatMoney(value: number): string {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}

/** 上下文占比的数字部分（不带 %，文案里自带）：不到 10 保留一位小数（0.9），其余取整；限制在 0–100。 */
export function formatPercent(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return String(clamped < 10 ? Number(clamped.toFixed(1)) : Math.round(clamped));
}
