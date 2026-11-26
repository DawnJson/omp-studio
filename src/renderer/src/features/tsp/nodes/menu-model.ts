// `menu` 节点的行（规范 TspMenuItem）和节点 `actions.menu` 的右键菜单项（规范 TspMenuEntry）：从 omp 给的 props 解析成纯数据，
// 画法在 menu.tsx（下拉）和 TspHosts.tsx（右键菜单）。不认得的形状丢掉；分隔线去掉开头、结尾和连着的。
import { isRecord } from "../../../../../shared/type-guards.ts";

export type MenuSeparator = { kind: "separator" };
export type MenuHeader = { kind: "header"; label: string };

/** `menu` 下拉里能选的一行。 */
export interface MenuRow {
  kind: "row";
  /** 选中时 `action` 事件的 `act`。 */
  id: string;
  label: string;
  icon?: string;
  /** 行右端的快捷键（只显示）。 */
  keys?: readonly string[];
  /** 标签下面的第二行。 */
  detail?: string;
  /** 勾选行 / 单选行的当前状态（单选行没给时算 false）。 */
  checked?: boolean;
  /** 单选行的组名。 */
  radio?: string;
  /** true 或原因：灰显、不能选。 */
  disabled?: true | string;
  danger?: boolean;
}

export type MenuModelEntry = MenuSeparator | MenuHeader | MenuRow;

/** 右键菜单里的一行：执行动作 `act`。 */
export interface ContextRow {
  kind: "row";
  act: string;
  /** 没有时按 act 写（actionLabel）。 */
  label?: string;
  icon?: string;
  detail?: string;
  disabled?: true | string;
  danger?: boolean;
}

export type ContextEntry = MenuSeparator | MenuHeader | ContextRow;

/** 动作名 / 行 id → 显示文字：`-` `.` `_` 换成空格、首字母大写（`btw-copy` → `Btw copy`）。 */
export function labelFromId(id: string): string {
  const text = id.replace(/[-._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function disabledOf(value: unknown): true | string | undefined {
  if (value === true) return true;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 分隔线不放在开头、结尾，也不连着两条（小节标题前面的除外，标题本身就分开了）。 */
function tidy<T extends { kind: string }>(entries: readonly T[]): T[] {
  const out: T[] = [];
  for (const entry of entries) {
    if (entry.kind === "separator" && (out.length === 0 || out.at(-1)!.kind === "separator")) continue;
    out.push(entry);
  }
  while (out.at(-1)?.kind === "separator") out.pop();
  return out;
}

function rowOf(item: Record<string, unknown>, id: string): MenuRow {
  const row: MenuRow = { kind: "row", id, label: str(item.label) ?? labelFromId(id) };
  const icon = str(item.icon);
  if (icon !== undefined) row.icon = icon;
  const keys =
    typeof item.keys === "string"
      ? [item.keys]
      : Array.isArray(item.keys)
        ? item.keys.filter((key): key is string => typeof key === "string")
        : [];
  if (keys.length > 0) row.keys = keys;
  const detail = str(item.detail);
  if (detail !== undefined) row.detail = detail;
  const radio = str(item.radio);
  if (radio !== undefined) row.radio = radio;
  if (typeof item.checked === "boolean") row.checked = item.checked;
  else if (radio !== undefined) row.checked = false;
  const disabled = disabledOf(item.disabled);
  if (disabled !== undefined) row.disabled = disabled;
  if (item.danger === true) row.danger = true;
  return row;
}

function flatten(items: readonly unknown[], out: MenuModelEntry[]): void {
  for (const item of items) {
    if (item === "-") out.push({ kind: "separator" });
    else if (typeof item === "string" && item !== "") out.push({ kind: "row", id: item, label: labelFromId(item) });
    else if (isRecord(item) && typeof item.header === "string") out.push({ kind: "header", label: item.header });
    else if (isRecord(item) && typeof item.id === "string" && item.id !== "") {
      if (Array.isArray(item.items)) {
        // 子菜单：桌面上就地展开成一个小节（行本身不发事件，规范），标题是这一行的文字。
        out.push({ kind: "separator" }, { kind: "header", label: str(item.label) ?? labelFromId(item.id) });
        flatten(item.items, out);
        out.push({ kind: "separator" });
      } else out.push(rowOf(item, item.id));
    }
  }
}

/** `menu` 节点的 `items` → 下拉里的行。 */
export function menuModel(items: unknown): MenuModelEntry[] {
  if (!Array.isArray(items)) return [];
  const out: MenuModelEntry[] = [];
  flatten(items, out);
  return tidy(out);
}

/** 选中一行要发的 `action` 字段：勾选行带翻过来的 `checked`，单选行总是 `checked: true`（规范）。 */
export function chosenAction(row: MenuRow): { act: string; checked?: boolean } {
  if (row.radio !== undefined) return { act: row.id, checked: true };
  if (row.checked !== undefined) return { act: row.id, checked: !row.checked };
  return { act: row.id };
}

/** 节点 `actions.menu` → 右键菜单项。 */
export function contextEntries(value: unknown): ContextEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ContextEntry[] = [];
  for (const entry of value) {
    if (entry === "-") out.push({ kind: "separator" });
    else if (typeof entry === "string" && entry !== "") out.push({ kind: "row", act: entry });
    else if (isRecord(entry) && typeof entry.header === "string") out.push({ kind: "header", label: entry.header });
    else if (isRecord(entry) && typeof entry.id === "string" && entry.id !== "") {
      const row: ContextRow = { kind: "row", act: entry.id };
      const label = str(entry.label);
      if (label !== undefined) row.label = label;
      const icon = str(entry.icon);
      if (icon !== undefined) row.icon = icon;
      const detail = str(entry.detail);
      if (detail !== undefined) row.detail = detail;
      const disabled = disabledOf(entry.disabled);
      if (disabled !== undefined) row.disabled = disabled;
      if (entry.danger === true) row.danger = true;
      out.push(row);
    }
  }
  return tidy(out);
}
