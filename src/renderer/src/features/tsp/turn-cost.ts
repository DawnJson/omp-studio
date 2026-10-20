// 每轮用量行里 omp 写的 `<$0.01`：换成会话文件里算出的准确费用。
// 行按 main 区里出现的顺序和费用数组"从末尾对齐"（最后一行 ↔ 最后一个数）；对不上就保留原文。

/** omp 对一分钱以下的费用的写法。 */
export const SUB_CENT = "<$0.01";

/** 准确费用：一分钱以上两位小数（$0.42），以下四位（$0.0031）。 */
export function formatExactCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** 从末尾数第 `fromEnd` 个（0 = 最后一行）用量行对应的费用；数组不够长、不是有效正数返回 undefined。 */
export function alignTurnCost(costs: readonly number[], fromEnd: number): number | undefined {
  if (fromEnd < 0) return undefined;
  const cost = costs[costs.length - 1 - fromEnd];
  return cost !== undefined && Number.isFinite(cost) && cost > 0 ? cost : undefined;
}

/** 把文字里的 `<$0.01` 换成准确费用；cost 未知或文字里没有 `<$0.01` 时原样返回。 */
export function withExactCost(text: string, cost: number | undefined): string {
  if (cost === undefined || !text.includes(SUB_CENT)) return text;
  return text.replace(SUB_CENT, formatExactCost(cost));
}
