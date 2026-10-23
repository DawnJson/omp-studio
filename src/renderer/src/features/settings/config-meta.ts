// omp 设置项的展示辅助：人话标签（常用项）、搜索、分组、值的显示。
// 常用项的标签和中文说明在 i18n 的 ompcfg 命名空间（`<键>.label` / `<键>.desc`）；没有的显示 key 加 omp 原始英文描述。
import { dictionaries } from "../../../../shared/i18n/index.ts";
import type { Locale, OmpConfigItem } from "../../../../shared/ipc.ts";
import { groupConfigItems, type ConfigGroup } from "../../../../shared/ui/config-groups.ts";

function entry(locale: Locale, name: string): string | undefined {
  const value = dictionaries[locale]["ompcfg"]?.[name];
  return typeof value === "string" ? value : undefined;
}

interface ConfigText {
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

/**
 * 各节页面上常用项的小块（spec §4.19）：一个小标题（`settings.block.<id>`）+ 一组格子。按 key 前缀归块，最长的前缀算数；
 * 块按这里的顺序排，块里按常用项的顺序（两列逐行填，所以字典里成对的项挨着放）。没归进任何块的放在最后，不带小标题。
 * `kinds`（特定能力的角色）没有 omp 的常用项，只放模型页自己的内容。
 */
export type CommonBlockId =
  "defaults" | "kinds" | "retry" | "fallback" | "approval" | "compaction" | "memory" | "subagents" | "goal";

const blockSpecs: readonly { id: CommonBlockId; prefixes: readonly string[] }[] = [
  { id: "defaults", prefixes: ["modelRole", "defaultThinkingLevel"] },
  { id: "kinds", prefixes: [] },
  { id: "retry", prefixes: ["retry."] },
  {
    id: "fallback",
    prefixes: ["retry.modelFallback", "retry.fallbackOn", "retry.fallbackChains", "retry.waitForUsageReset"],
  },
  { id: "approval", prefixes: ["tools.", "bash."] },
  { id: "compaction", prefixes: ["compaction."] },
  { id: "memory", prefixes: ["memory.", "mnemopi.", "hindsight."] },
  { id: "subagents", prefixes: ["task."] },
  { id: "goal", prefixes: ["goal."] },
];

/** 格子里独占一整行的项：它下面那几格是它的子设置（记忆后端下面左列 Mnemopi、右列 Hindsight）。 */
export const spanKeys: ReadonlySet<string> = new Set(["memory.backend"]);

export interface CommonBlock {
  /** "" = 没归进任何块。 */
  id: CommonBlockId | "";
  items: OmpConfigItem[];
}

/** `withLeads`：页面自己有内容的块，没有常用项也要排进来。 */
export function commonBlocks(items: readonly OmpConfigItem[], withLeads: readonly CommonBlockId[] = []): CommonBlock[] {
  const byId = new Map<CommonBlockId | "", OmpConfigItem[]>();
  for (const item of items) {
    let id: CommonBlockId | "" = "";
    let longest = 0;
    for (const spec of blockSpecs)
      for (const prefix of spec.prefixes)
        if (item.key.startsWith(prefix) && prefix.length > longest) {
          id = spec.id;
          longest = prefix.length;
        }
    byId.set(id, [...(byId.get(id) ?? []), item]);
  }
  const order: (CommonBlockId | "")[] = [...blockSpecs.map((spec) => spec.id), ""];
  return order.flatMap((id) => {
    const inBlock = byId.get(id) ?? (id !== "" && withLeads.includes(id) ? [] : undefined);
    return inBlock === undefined ? [] : [{ id, items: inBlock }];
  });
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

export type NumberUnit = "ms" | "seconds" | "percent";

/** 数字项的单位，从 key 最后一段的后缀推：Ms → ms、Seconds → 秒 / s、Percent → %。 */
export function numberUnit(key: string): NumberUnit | null {
  const last = key.slice(key.lastIndexOf(".") + 1);
  if (last.endsWith("Ms")) return "ms";
  if (last.endsWith("Seconds")) return "seconds";
  if (last.endsWith("Percent")) return "percent";
  return null;
}

/**
 * 数字项里有特殊含义的取值（omp 的说明里写了 -1 / 0 表示什么）：框里不显示这个数，显示成 `<键>.special` 的占位文字；
 * 清空输入框就是存回这个值。没有说明的键照原值显示。
 */
const numberSpecials: Readonly<Record<string, number>> = {
  "compaction.thresholdPercent": -1,
  "compaction.thresholdTokens": -1,
  "task.maxRuntimeMs": 0,
  "retry.maxDelayMs": 0,
};

export function numberSpecial(locale: Locale, key: string): { value: number; placeholder: string } | null {
  const value = numberSpecials[key];
  const placeholder = entry(locale, `${key}.special`);
  return value === undefined || placeholder === undefined ? null : { value, placeholder };
}

/** 高级页的一个分组：前缀小组（带个数和改过的个数）。 */
export interface AdvancedGroup {
  group: ConfigGroup;
  prefixes: (PrefixGroup & { modified: number })[];
  count: number;
  modified: number;
}

export function advancedGroups(items: readonly OmpConfigItem[]): AdvancedGroup[] {
  const result: AdvancedGroup[] = [];
  for (const [group, inGroup] of groupConfigItems(items)) {
    const prefixes = prefixGroups(inGroup).map((bucket) => ({
      ...bucket,
      modified: bucket.items.filter(isModified).length,
    }));
    if (prefixes.length === 0) continue;
    result.push({
      group,
      prefixes,
      count: prefixes.reduce((sum, bucket) => sum + bucket.items.length, 0),
      modified: prefixes.reduce((sum, bucket) => sum + bucket.modified, 0),
    });
  }
  return result;
}
