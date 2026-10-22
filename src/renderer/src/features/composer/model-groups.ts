// 模型选择对话框的列表：按搜索词过滤；没有搜索词时"常用"（当前模型、角色绑定的模型、最近用过的）单独置顶，其余按 provider 排序。
// 搜索框以 @ 开头时列的是角色而不是模型。纯函数。
import { formatCount } from "./usage-format.ts";
import type { ModelKey, ModelOption } from "../../../../shared/ipc.ts";

export interface ModelRows {
  /** 常用：按传入顺序；有搜索词时为空。 */
  pinned: ModelOption[];
  /** 其余（全部 / 匹配），按 provider、名称排序。 */
  rest: ModelOption[];
  /** 界面上从上到下的顺序（常用 + 其余），方向键按它移动。 */
  flat: ModelOption[];
}

export const sameModel = (a: ModelKey, b: ModelKey) => a.provider === b.provider && a.modelId === b.modelId;

const price = (value: number) => String(Number(value.toFixed(3)));

/** 表格里的价格列："$0.3·1.2"（输入·输出，美元/百万 token）；价格全 0（免费或未标价）为 null。 */
export function modelPriceCell(option: ModelOption): string | null {
  const { input, output } = option.cost;
  return input > 0 || output > 0 ? `$${price(input)}·${price(output)}` : null;
}

/** 底部参数行里的价格："$0.3/1.2"；价格全 0 为 null。 */
export function modelPriceLine(option: ModelOption): string | null {
  const { input, output } = option.cost;
  return input > 0 || output > 0 ? `$${price(input)}/${price(output)}` : null;
}

/** 表格里的上下文列："1M"；没有为 null。 */
export const modelContextCell = (option: ModelOption): string | null =>
  option.contextWindow === null ? null : formatCount(option.contextWindow);

/** 常用模型：当前模型在最前，然后是角色绑定的模型、最近用过的；去重，只保留列表里有的。 */
export function pinnedKeys(
  current: ModelKey | null,
  bound: readonly (ModelOption | null | undefined)[],
  recent: readonly ModelKey[],
): ModelKey[] {
  const keys: ModelKey[] = [];
  const add = (key: ModelKey | null | undefined) => {
    if (key && !keys.some((existing) => sameModel(existing, key))) keys.push(key);
  };
  add(current);
  for (const option of bound) add(option?.key);
  for (const key of recent) add(key);
  return keys;
}

const byProvider = (a: string, b: string) => a.localeCompare(b);

/** provider 为 null = 全部模型；给了就只列这个 provider 的，不单列常用。 */
export function groupModels(
  models: readonly ModelOption[],
  query: string,
  pinned: readonly ModelKey[],
  provider: string | null = null,
): ModelRows {
  const needle = query.trim().toLowerCase();
  const filtered = models.filter(
    (model) =>
      (provider === null || model.key.provider === provider) &&
      (needle === "" || `${model.name} ${model.key.provider} ${model.key.modelId}`.toLowerCase().includes(needle)),
  );
  const pinnedRows =
    needle === "" && provider === null
      ? pinned.flatMap((key) => filtered.filter((model) => sameModel(model.key, key)))
      : [];
  const rest = filtered
    .filter((model) => !pinnedRows.includes(model))
    .sort((a, b) => byProvider(a.key.provider, b.key.provider) || a.name.localeCompare(b.name));
  return { pinned: pinnedRows, rest, flat: [...pinnedRows, ...rest] };
}

/** 对话框左栏的提供商：列表里出现的 provider 和各自的模型数，顺序和表里的分组一致。 */
export function providerCounts(models: readonly ModelOption[]): { provider: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const model of models) counts.set(model.key.provider, (counts.get(model.key.provider) ?? 0) + 1);
  return [...counts]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => byProvider(a.provider, b.provider));
}

/** 搜索框以 @ 开头时按角色名过滤（@ 之后的部分，前缀 / 包含都算）；不是 @ 开头为 null。 */
export function filterRoles(tabs: readonly string[], query: string): string[] | null {
  const trimmed = query.trimStart();
  if (!trimmed.startsWith("@")) return null;
  const needle = trimmed.slice(1).trim().toLowerCase();
  return tabs.filter((role) => role.toLowerCase().includes(needle));
}

export const modelItemId = (key: ModelKey) => `m:${key.provider}/${key.modelId}`;
export const roleItemId = (role: string) => `r:${role}`;

/** omp 内置的、选择器里可单独指定模型的角色（顺序即标签顺序）；modelRoles 里别的角色只在指到列表中的模型时才加进来。 */
export const builtinRoles = ["default", "smol", "slow", "plan", "task", "commit", "advisor"] as const;

const thinkingSuffix = /:(?:off|minimal|low|medium|high|xhigh|max)$/;

/** `provider/model-id[:thinking]` → 模型；不是这种形式（`@role` 别名、`web/tavily` 之类不在列表里的）时由调用方对照列表过滤。 */
export function parseRoleSelector(selector: string): ModelKey | null {
  const body = selector.replace(thinkingSuffix, "");
  const slash = body.indexOf("/");
  if (slash <= 0 || slash === body.length - 1) return null;
  return { provider: body.slice(0, slash), modelId: body.slice(slash + 1) };
}

export interface RoleView {
  /** 标签：内置角色 + 指到列表中模型的其它角色。 */
  tabs: string[];
  /** 角色 → 它现在指的模型（没设置或不在列表里为 null）。 */
  modelOf: Record<string, ModelOption | null>;
  /** 模型 → 指到它的角色（按标签顺序），列表行上的徽标用。 */
  badges: Map<string, string[]>;
}

export function roleView(roles: Readonly<Record<string, string>>, models: readonly ModelOption[]): RoleView {
  const modelOf: Record<string, ModelOption | null> = {};
  for (const [role, selector] of Object.entries(roles)) {
    const key = parseRoleSelector(selector);
    modelOf[role] = (key && models.find((option) => sameModel(option.key, key))) || null;
  }
  const extra = Object.keys(roles).filter(
    (role) => modelOf[role] && !(builtinRoles as readonly string[]).includes(role),
  );
  const tabs = [...builtinRoles, ...extra];
  const badges = new Map<string, string[]>();
  for (const role of tabs) {
    const option = modelOf[role];
    if (!option) continue;
    const id = modelItemId(option.key);
    badges.set(id, [...(badges.get(id) ?? []), role]);
  }
  return { tabs, modelOf, badges };
}
