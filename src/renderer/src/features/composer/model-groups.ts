// 模型选择对话框的列表：按搜索词过滤，按 provider 分组；没有搜索词时最近用过的模型单独置顶。纯函数。
import { formatCount } from "./usage-format.ts";
import type { ModelKey, ModelOption } from "../../../../shared/ipc.ts";

export interface ModelGroup {
  provider: string;
  models: ModelOption[];
}

export interface ModelRows {
  recent: ModelOption[];
  groups: ModelGroup[];
  /** 界面上从上到下的顺序（最近 + 各组），方向键按它移动。 */
  flat: ModelOption[];
}

export const sameModel = (a: ModelKey, b: ModelKey) => a.provider === b.provider && a.modelId === b.modelId;

/** 模型行右侧的紧凑信息："1M · $0.3/$1.2"（上下文窗口 · 输入/输出价格，美元/百万 token）；没有的部分省略，价格全 0（免费或未标价）不显示。 */
export function modelRowMeta(option: ModelOption): string {
  const parts: string[] = [];
  if (option.contextWindow !== null) parts.push(formatCount(option.contextWindow));
  const { input, output } = option.cost;
  if (input > 0 || output > 0) {
    const price = (value: number) => `$${Number(value.toFixed(3))}`;
    parts.push(`${price(input)}/${price(output)}`);
  }
  return parts.join(" · ");
}

export function groupModels(models: readonly ModelOption[], query: string, recent: readonly ModelKey[]): ModelRows {
  const needle = query.trim().toLowerCase();
  const filtered = models.filter(
    (model) =>
      needle === "" || `${model.name} ${model.key.provider} ${model.key.modelId}`.toLowerCase().includes(needle),
  );
  const recentRows =
    needle === "" ? recent.flatMap((key) => filtered.filter((model) => sameModel(model.key, key))) : [];
  const rest = filtered
    .filter((model) => !recentRows.includes(model))
    .sort((a, b) => a.key.provider.localeCompare(b.key.provider) || a.name.localeCompare(b.name));
  const groups: ModelGroup[] = [];
  for (const model of rest) {
    const last = groups.at(-1);
    if (last && last.provider === model.key.provider) last.models.push(model);
    else groups.push({ provider: model.key.provider, models: [model] });
  }
  return { recent: recentRows, groups, flat: [...recentRows, ...groups.flatMap((group) => group.models)] };
}
