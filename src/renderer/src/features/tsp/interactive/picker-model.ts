// picker 的纯逻辑：目录补丁、可见条目（分组头 + 行）及其定位、事实列显示、头像颜色。规范 elements-lists.md#picker。
import type {
  TspPickerColumn,
  TspPickerGroup,
  TspPickerItem,
  TspPickerProps,
} from "../../../../../shared/tsp/tsp.generated.ts";

/** 目录：`items` 整体替换；`itemsAdd` 按 id 增补 / 覆盖；`itemsDel` 按 id 删除。 */
export interface PickerCatalog {
  items: Map<string, TspPickerItem>;
  /** 上次处理过的三个数组（按引用判断有没有新补丁；节点记录不可变，没变的 prop 引用不变）。 */
  seen: { items: unknown; add: unknown; del: unknown };
}

export function emptyCatalog(): PickerCatalog {
  return { items: new Map(), seen: { items: undefined, add: undefined, del: undefined } };
}

/** 把这一版 props 里的新补丁并进目录（就地改并返回同一个对象；同一个补丁重复调用无副作用）。 */
export function updateCatalog(
  catalog: PickerCatalog,
  p: Pick<TspPickerProps, "items" | "itemsAdd" | "itemsDel">,
): PickerCatalog {
  if (p.items !== catalog.seen.items) {
    catalog.items = new Map((p.items ?? []).map((item) => [item.id, item]));
    catalog.seen.items = p.items;
  }
  if (p.itemsDel !== catalog.seen.del) {
    for (const id of p.itemsDel ?? []) catalog.items.delete(id);
    catalog.seen.del = p.itemsDel;
  }
  if (p.itemsAdd !== catalog.seen.add) {
    for (const item of p.itemsAdd ?? []) if (item.id) catalog.items.set(item.id, item);
    catalog.seen.add = p.itemsAdd;
  }
  return catalog;
}

export type PickerEntry =
  | { kind: "group"; group: TspPickerGroup; top: number; height: number }
  | { kind: "row"; item: TspPickerItem; top: number; height: number };

const GROUP_HEIGHT = 32;

function rowHeight(layout: TspPickerProps["layout"], item: TspPickerItem): number {
  switch (layout) {
    case "cards":
      return 54;
    case "timeline":
      return item.node === "user" ? 34 : 26;
    case "tree":
      return 24;
    default:
      return 36;
  }
}

/** 按 `order`（缺省为目录顺序）展开成条目并算出每条的位置；order 里不认识的 id 跳过。 */
export function buildEntries(
  catalog: Map<string, TspPickerItem>,
  order: TspPickerProps["order"],
  layout: TspPickerProps["layout"],
): { entries: PickerEntry[]; total: number; rows: number } {
  const entries: PickerEntry[] = [];
  let top = 0;
  let rows = 0;
  const source: readonly (string | TspPickerGroup)[] = order ?? [...catalog.keys()];
  for (const entry of source) {
    if (typeof entry === "string") {
      const item = catalog.get(entry);
      if (!item) continue;
      const height = rowHeight(layout, item);
      entries.push({ kind: "row", item, top, height });
      top += height;
      rows += 1;
    } else if (typeof entry === "object" && "group" in entry) {
      entries.push({ kind: "group", group: entry, top, height: GROUP_HEIGHT });
      top += GROUP_HEIGHT;
    }
  }
  return { entries, total: top, rows };
}

/** 滚动窗口内的条目下标范围（含上下各 overscan 行）。 */
export function visibleRange(
  entries: readonly Pick<PickerEntry, "top" | "height">[],
  scrollTop: number,
  viewport: number,
  overscan: number,
): [number, number] {
  let first = 0;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = entries[mid];
    if (e && e.top + e.height <= scrollTop) lo = mid + 1;
    else {
      first = mid;
      hi = mid - 1;
    }
  }
  let last = first;
  while (last < entries.length && (entries[last]?.top ?? Infinity) < scrollTop + viewport) last += 1;
  return [Math.max(0, first - overscan), Math.min(entries.length, last + overscan)];
}

const COLUMN_WIDTH: Readonly<Record<string, number>> = {
  text: 96,
  num: 52,
  price: 76,
  bar: 44,
  time: 44,
  elapsed: 52,
  dim: 64,
};

const LABEL_MIN_WIDTH = 260;

function columnWidth(column: TspPickerColumn): number {
  return COLUMN_WIDTH[column.format ?? "text"] ?? 96;
}

/** 宽度不够时按 priority 从低到高藏事实列，直到标签有 260px。返回保留的列（保持原顺序）。 */
export function visibleColumns(columns: readonly TspPickerColumn[], width: number): TspPickerColumn[] {
  const kept = columns.slice(0, 8);
  const byPriority = [...kept].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  let used = kept.reduce((sum, c) => sum + columnWidth(c), 0);
  const hidden = new Set<TspPickerColumn>();
  for (const column of byPriority) {
    if (width - used >= LABEL_MIN_WIDTH) break;
    hidden.add(column);
    used -= columnWidth(column);
  }
  return kept.filter((c) => !hidden.has(c));
}

/** 数字的紧凑写法：272000 → 272k，1600000 → 1.6M。 */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}k`;
  return trim(n);
}

/** 头像：`text` 的前两个非空白字符。 */
export function markInitials(text: string): string {
  return [...text.replace(/\s+/g, "")].slice(0, 2).join("");
}

/** 头像色相：同一个 seed 永远同一种颜色。 */
export function markHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

/** mono 标签里的 `dir/name` 拆分：最后一个 `/` 之前（含）是 dir。没有 `/` 时 dir 为空。 */
export function splitMonoLabel(label: string): { dir: string; name: string } {
  const at = label.lastIndexOf("/");
  return at < 0 ? { dir: "", name: label } : { dir: label.slice(0, at + 1), name: label.slice(at + 1) };
}

/** 行的前导图标 role（`omp.tool.grep` → `grep`）：omp 在 tree / timeline 行上给的 `item.role`；不是工具 role 返回 null。 */
export function toolNameOfRole(role: string | undefined): string | null {
  return /^omp\.tool\.([^.\s]+)/.exec(role ?? "")?.[1] ?? null;
}
