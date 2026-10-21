export function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

/** 1234567 → 1.2M；小于一万原样加千分位。 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${(count / 1000).toFixed(1)}k`;
  return count.toLocaleString("en-US");
}

/** `deepseek/deepseek-v4-flash` → `deepseek-v4-flash`（完整名放悬停提示）。 */
export function shortModel(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1);
}
