// 支持的最低 omp 版本（决策 D4：wire 文件和两份 fixture 的录制版本）。主进程判断 belowMinimum，界面显示要求的版本。
export const MIN_OMP_VERSION = "18.12.0";

/** 比较 `18.12.1` 这类版本号：数字段逐段比，数字相同时带预发布后缀（`-canary.1`）的小于不带的。 */
export function compareVersions(a: string, b: string): number {
  const [coreA = "", preA] = a.split(/-(.*)/s);
  const [coreB = "", preB] = b.split(/-(.*)/s);
  const partsA = coreA.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = coreB.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (preA === undefined && preB === undefined) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : preA > preB ? 1 : 0;
}
