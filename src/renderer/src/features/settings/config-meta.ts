// omp 设置项的展示辅助：人话标签（常用项）、搜索、分组、值的显示。
// 常用项的标签和中文说明在 i18n 的 ompcfg 命名空间（`<键>.label` / `<键>.desc`）；没有的显示 key 加 omp 原始英文描述。
import { dictionaries } from "../../../../shared/i18n/index.ts";
import type { Locale, OmpConfigItem } from "../../../../shared/ipc.ts";

function entry(locale: Locale, name: string): string | undefined {
  const value = dictionaries[locale]["ompcfg"]?.[name];
  return typeof value === "string" ? value : undefined;
}

export interface ConfigText {
  /** 常用项的人话标签；其余为 null（界面显示 key）。 */
  label: string | null;
  /** 描述；常用项是中/英文说明，其余是 omp 原文。 */
  description: string;
  /** 描述是 omp 的英文原文（中文界面里要标出来）。 */
  original: boolean;
}

export function configText(locale: Locale, item: OmpConfigItem): ConfigText {
  const label = entry(locale, `${item.key}.label`);
  if (label !== undefined)
    return { label, description: entry(locale, `${item.key}.desc`) ?? item.description, original: false };
  return { label: null, description: item.description, original: true };
}

/** 常用项的顺序就是 zh-CN 字典里的顺序（按模型角色、审批/工具、压缩、记忆、子代理、retry 排）。 */
const commonOrder: ReadonlyMap<string, number> = new Map(
  Object.keys(dictionaries["zh-CN"]["ompcfg"] ?? {})
    .filter((name) => name.endsWith(".label"))
    .map((name, index) => [name.slice(0, -".label".length), index]),
);

/** omp-studio 分组的名字（`group.<id>`）。 */
export function groupTitle(locale: Locale, group: string): string {
  return entry(locale, `group.${group}`) ?? group;
}

/** 按 key、omp 原描述、两种语言的标签和说明搜索（不区分大小写）；多个词要全部命中。 */
export function matchesQuery(item: OmpConfigItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    item.key,
    item.description,
    entry("zh-CN", `${item.key}.label`),
    entry("zh-CN", `${item.key}.desc`),
    entry("en", `${item.key}.label`),
    entry("en", `${item.key}.desc`),
  ]
    .filter((part): part is string => !!part)
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** 常用项：有人话标签的键（各节页面上只放这些），按字典顺序。 */
function isCommon(key: string): boolean {
  return commonOrder.has(key);
}

export function commonItems(items: readonly OmpConfigItem[]): OmpConfigItem[] {
  return items
    .filter((item) => isCommon(item.key))
    .sort((a, b) => (commonOrder.get(a.key) ?? 0) - (commonOrder.get(b.key) ?? 0));
}

export interface PrefixGroup {
  /** key 的第一段；"" = 没有点号的顶层键和只有一项的前缀，合成"其他"。 */
  prefix: string;
  items: OmpConfigItem[];
}

/** "高级"里一个分组的非常用项：按 key 的第一段分小组，保持 omp 的顺序；只有一项的前缀并进最后的"其他"，不单独占一行。 */
export function prefixGroups(items: readonly OmpConfigItem[]): PrefixGroup[] {
  const byPrefix = new Map<string, OmpConfigItem[]>();
  for (const item of items) {
    if (isCommon(item.key)) continue;
    const dot = item.key.indexOf(".");
    const prefix = dot === -1 ? "" : item.key.slice(0, dot);
    const bucket = byPrefix.get(prefix);
    if (bucket) bucket.push(item);
    else byPrefix.set(prefix, [item]);
  }
  const groups: PrefixGroup[] = [];
  const rest: OmpConfigItem[] = [];
  for (const [prefix, bucket] of byPrefix) {
    if (prefix === "" || bucket.length === 1) rest.push(...bucket);
    else groups.push({ prefix, items: bucket });
  }
  if (rest.length > 0) groups.push({ prefix: "", items: rest });
  return groups;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 和 omp 自己的默认值不同。 */
export function isModified(item: OmpConfigItem): boolean {
  if (item.redacted) return item.hasValue;
  if (item.hasValue !== item.hasDefault) return true;
  return item.hasValue && !same(item.value, item.defaultValue);
}

/** 给"默认：…"和数组/对象摘要用的短文本。 */
export function shortValue(value: unknown, max = 48): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
