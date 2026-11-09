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

/**
 * 缓存命中率（0–1）：cacheRead ÷ (input + cacheRead + cacheWrite)。omp 会话文件 usage 的 `input` 不含缓存读写
 * （各 provider 都归一成这样，如 Google 的 input = promptTokenCount − cachedContentTokenCount；本机会话文件实测
 * totalTokens = input + output + cacheRead + cacheWrite），所以分母是整个提示的 token 数。
 * 没有缓存数据（cacheRead、cacheWrite 都是 0）时 null：不显示这一行。
 */
export function cacheHitRate(tokens: { input: number; cacheRead: number; cacheWrite: number }): number | null {
  if (tokens.cacheRead + tokens.cacheWrite <= 0) return null;
  return tokens.cacheRead / (tokens.input + tokens.cacheRead + tokens.cacheWrite);
}
