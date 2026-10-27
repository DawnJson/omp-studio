// 节点 props 是 `Record<string, unknown>`（来自程序，不可信）：读嵌套字段前先收窄，不靠断言。
import { finiteNumber, isRecord } from "../../../../shared/type-guards.ts";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return finiteNumber(value) ?? undefined;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** preview 属性（`{lines:N}` / `"auto"`）→ 行数；不是正数或没给返回 null。`auto` = 10。 */
export function previewToLines(preview: unknown): number | null {
  if (preview === "auto") return 10;
  if (isRecord(preview)) {
    const lines = asNumber(preview.lines);
    if (lines !== undefined && Math.floor(lines) >= 1) return Math.floor(lines);
  }
  return null;
}
