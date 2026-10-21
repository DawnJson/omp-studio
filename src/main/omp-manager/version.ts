// omp 版本号比较在 shared/omp-version.ts（更新日志的排序也要用）。
import { compareVersions, MIN_OMP_VERSION } from "../../shared/omp-version.ts";

export { MIN_OMP_VERSION };

export function isBelowMinimum(version: string): boolean {
  return compareVersions(version, MIN_OMP_VERSION) < 0;
}
