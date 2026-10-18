/** 解析外部数据（磁盘上的 JSONL 等）时用：只证明是对象，字段仍是 unknown，用到时再逐个检查。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
