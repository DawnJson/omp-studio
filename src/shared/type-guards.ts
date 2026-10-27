// 解析外部数据（磁盘上的 JSONL、omp 的 JSON 输出、SQLite 行、程序发来的节点 props）时共用的收窄：只证明形状，字段仍是 unknown，用到时再逐个检查。

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 有限数原样返回，其它（NaN、Infinity、不是数）返回 null。 */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 有限数原样返回，其它当 0（计数、token、花费这类缺了就是没有的量）。 */
export function finiteOrZero(value: unknown): number {
  return finiteNumber(value) ?? 0;
}

/** 非空字符串原样返回，空串和不是字符串返回 null。 */
export function nonEmptyString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}
