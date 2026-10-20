// 改动卡片的行数条（3.0 §3.4，照 git diff --stat）：每行最多 24 个字符。
import type { FileChange } from "./tool-info.ts";

export const BAR_MAX = 24;

export interface DiffBar {
  plus: number;
  minus: number;
}

/**
 * 每个文件的 `+++−−` 条字符数；行数未知（added 为 null）的文件返回 null（不画条）。
 * 一张卡里改动最多的文件 ≤24 行时一行一个字符；超过时整张卡按同一比例缩小，不为 0 的一边至少留 1 个字符，总数不超过 24。
 */
export function diffBars(changes: readonly FileChange[]): (DiffBar | null)[] {
  const max = changes.reduce(
    (peak, change) => (change.added === null ? peak : Math.max(peak, change.added + (change.removed ?? 0))),
    0,
  );
  const scale = max > BAR_MAX ? BAR_MAX / max : 1;
  return changes.map((change) => {
    if (change.added === null) return null;
    const added = change.added;
    const removed = change.removed ?? 0;
    if (scale === 1) return { plus: added, minus: removed };
    let plus = added > 0 ? Math.max(1, Math.round(added * scale)) : 0;
    let minus = removed > 0 ? Math.max(1, Math.round(removed * scale)) : 0;
    // 四舍五入加"至少 1 个"可能超出 24：从较长的一边扣回来。
    while (plus + minus > BAR_MAX) {
      if (plus >= minus && plus > 1) plus -= 1;
      else if (minus > 1) minus -= 1;
      else plus -= 1;
    }
    return { plus, minus };
  });
}
