// prefs 的纯逻辑：控件下一个值、分段还是弹出、多选 / 排序列表的新值、搜索词命中。规范 elements-work.md#prefs。
import type { TspPrefsControl } from "../../../../../shared/tsp/tsp.generated.ts";
import type { HitRange } from "./text-model.ts";

type Choice = Extract<TspPrefsControl, { k: "choice" }>;
type NumberControl = Extract<TspPrefsControl, { k: "number" }>;
type Multi = Extract<TspPrefsControl, { k: "multi" }>;

/** choice 画成分段：style 为 segmented，或 auto（缺省）且 2–4 个选项、标签合计不超过 28 个字符。 */
export function isSegmented(control: Choice): boolean {
  if (control.style === "segmented") return true;
  if (control.style === "menu") return false;
  const n = control.options.length;
  return n >= 2 && n <= 4 && control.options.reduce((sum, o) => sum + [...o.label].length, 0) <= 28;
}

/** number 控件按 − / + 之后的值：有 labels 时取 labels 键里的上一个 / 下一个，否则 value ± step 钳到 min / max。没路可走返回 null。 */
export function nextNumber(control: NumberControl, direction: -1 | 1): number | null {
  if (control.labels !== undefined) {
    const keys = Object.keys(control.labels)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const next = direction > 0 ? keys.find((k) => k > control.value) : keys.findLast((k) => k < control.value);
    return next ?? null;
  }
  const step = control.step ?? 1;
  const raw = control.value + direction * step;
  const clamped = Math.min(control.max ?? Infinity, Math.max(control.min ?? -Infinity, raw));
  return clamped === control.value ? null : clamped;
}

/** number 控件显示的文字：labels 里有就用 label，否则数字加 unit。 */
export function numberLabel(control: NumberControl): string {
  const label = control.labels?.[String(control.value)];
  if (label !== undefined) return label;
  return control.unit === undefined ? String(control.value) : `${control.value}${control.unit}`;
}

/** multi 切换一项后"启用的值，按顺序"：关掉就移除，打开就追加到末尾。 */
export function toggleMulti(control: Multi, value: string): string[] {
  return control.values.includes(value) ? control.values.filter((v) => v !== value) : [...control.values, value];
}

/** 排序列表：把 `moved` 拖到 `target` 前（lowerHalf 为真则放在它后面），并保证它启用。返回新的启用顺序。 */
export function moveOrdered(values: readonly string[], moved: string, target: string, lowerHalf: boolean): string[] {
  if (moved === target) return [...values];
  const rest = values.filter((v) => v !== moved);
  const at = rest.indexOf(target);
  if (at < 0) return [...rest, moved];
  rest.splice(lowerHalf ? at + 1 : at, 0, moved);
  return rest;
}

/** 排序列表的显示顺序：启用的在前（按 values 的顺序），其余按 options 的顺序。 */
export function orderedOptions<T extends { value: string }>(options: readonly T[], values: readonly string[]): T[] {
  const byValue = new Map(options.map((o) => [o.value, o]));
  const enabled = values.map((v) => byValue.get(v)).filter((o): o is T => o !== undefined);
  return [...enabled, ...options.filter((o) => !values.includes(o.value))];
}

/** 搜索词里每个词（空白分隔）在文字里所有不分大小写的出现位置。 */
export function wordHits(text: string, query: string): HitRange[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  const raw: [number, number][] = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(word, from);
      if (at < 0) break;
      raw.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
