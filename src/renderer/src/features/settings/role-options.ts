// 角色和备用链的下拉选项：按角色能用的模型类别（composer/model-groups 的 roleKinds，照 omp 的 accepts）从对话模型和
// 非对话模型里挑，自己的类别在前。对话模型来自 get_available_models，非对话模型来自 `omp models --kind all --json`。纯函数。
import type { ModelKey, ModelOption, RunnerModel } from "../../../../shared/ipc.ts";
import { roleKinds } from "../composer/model-groups.ts";

export const selectorOf = (key: ModelKey) => `${key.provider}/${key.modelId}`;

export interface Candidate {
  /** omp 的选择器 `provider/model-id`。 */
  value: string;
  label: string;
  key: ModelKey;
  /** 下拉里按 provider 分组折叠（ui/Select 的 group）。 */
  group: string;
}

/** null = 这一类还没读到。 */
export interface ModelSources {
  chat: readonly ModelOption[] | null;
  runners: readonly RunnerModel[] | null;
}

/** 这些类别的模型都读到了才算齐（没读到时下拉不让选，免得列表不全）。 */
export function sourcesReady(kinds: readonly string[], sources: ModelSources): boolean {
  return kinds.every((kind) => (kind === "chat" ? sources.chat !== null : sources.runners !== null));
}

/** `modelRoles` 的形状：角色 → 选择器。 */
export function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/** `retry.fallbackChains` 的形状：角色或模型 → 有序的选择器列表。 */
export function isChainRecord(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"))
  );
}

/** 当前值不在候选里（带思考后缀、`@role` 别名、已退出登录的 provider）时原样保留成一个选项，别让下拉悄悄显示成别的。 */
export function withCurrent<T extends { value: string; label: string }>(
  options: readonly T[],
  current: string | null,
): (T | { value: string; label: string })[] {
  return current === null || current === "" || options.some((option) => option.value === current)
    ? [...options]
    : [...options, { value: current, label: current }];
}

const candidate = (model: { key: ModelKey; name: string }): Candidate => ({
  value: selectorOf(model.key),
  label: model.name,
  key: model.key,
  group: model.key.provider,
});

/** 自己的类别在前；下拉按 provider 分组，组按 provider 名排（同模型选择对话框），组内保持类别顺序。 */
export function candidatesOfKinds(kinds: readonly string[], sources: ModelSources): Candidate[] {
  return kinds
    .flatMap((kind) =>
      kind === "chat"
        ? (sources.chat ?? []).map(candidate)
        : (sources.runners ?? []).filter((model) => model.kind === kind).map(candidate),
    )
    .sort((a, b) => a.group.localeCompare(b.group));
}

/**
 * 备用链的 key 能用哪类模型：没有 `/` 的是角色（按角色）；`provider/model` 是非对话模型就用它那一类，否则是对话模型；
 * `provider/*` 用那个 provider 有的全部类别（一个 provider 可以既有对话模型又有生图模型），认不出来的当对话模型。
 */
export function chainKinds(key: string, sources: ModelSources): readonly string[] {
  if (!key.includes("/")) return roleKinds(key);
  const runners = sources.runners ?? [];
  if (!key.endsWith("/*")) {
    const runner = runners.find((model) => selectorOf(model.key) === key);
    return runner === undefined ? ["chat"] : [runner.kind];
  }
  const provider = key.slice(0, -2);
  const kinds = [
    ...((sources.chat ?? []).some((model) => model.key.provider === provider) ? ["chat"] : []),
    ...runners.filter((model) => model.key.provider === provider).map((model) => model.kind),
  ];
  return kinds.length === 0 ? ["chat"] : [...new Set(kinds)];
}
