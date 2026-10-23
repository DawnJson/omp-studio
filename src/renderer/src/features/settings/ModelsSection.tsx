// 设置 → 模型：新任务的默认模型 / 思考强度、各角色的模型，以及 omp "模型与推理"组的常用项（重试与备用模型），按小块排成格子。
// 默认值就是 omp 自己的 modelRoles.default / defaultThinkingLevel（设计原则 7），和 omp 设置是同一份；角色（smol、slow…）每个一格
// 下拉，改了就写全局的 modelRoles（和模型选择对话框里给角色"应用"一样）。模型列表来自提供商与账号页同一份读取（accounts-store）。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { reportError } from "../../ui/errors.ts";
import { useCallback, useEffect } from "react";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import {
  defaultModelRole,
  ensureOmpConfigLoaded,
  saveOmpDefaultThinking,
  saveOmpModelRole,
  useOmpConfigValue,
} from "./config-store.ts";
import { loadAccounts, useAccountLoad } from "./accounts-store.ts";
import { Row, type Option } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";
import { CommonConfig } from "./ConfigSection.tsx";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";
import { builtinRoles } from "../composer/model-groups.ts";

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const inherit = "";
// 默认思考强度和各角色上面已经有下拉，omp 的同一项不再重复一行（搜索里照旧有）。
const shownAbove = ["defaultThinkingLevel", "modelRoles"];

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

const modelKey = (model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`;

export function ModelsSection() {
  const t = useT();
  const roles = useOmpConfigValue("modelRoles");
  const defaultModel = defaultModelRole(roles);
  const roleValues: Record<string, unknown> = typeof roles === "object" && roles !== null ? { ...roles } : {};
  // default 是上面的"新任务的默认模型"；其余是 omp 的内置角色，再加配置里另有的角色。
  const roleNames = [...builtinRoles, ...Object.keys(roleValues)].filter(
    (role, index, all) => role !== "default" && all.indexOf(role) === index,
  );
  const thinking = useOmpConfigValue("defaultThinkingLevel");
  const load = useAccountLoad();
  const data = load.kind === "ready" ? load.data : null;
  const common = useCommonConfigItems("models", shownAbove);

  // 有缓存就直接显示，进入时后台刷新一次。
  const enter = useCallback(() => void loadAccounts(), []);
  useEffect(enter, [enter]);
  useEffect(ensureOmpConfigLoaded, []);
  const listed: Option<string>[] = (data?.models ?? []).map((model) => ({
    value: modelKey(model.key),
    label: model.name,
  }));
  // 角色的值可能带思考后缀或写成别的形式，也可能已不在列表里：原样保留，别让下拉悄悄显示成别的。
  const optionsFor = (first: string, current: string | null): Option<string>[] => [
    { value: inherit, label: first },
    ...listed,
    ...(current !== null && !listed.some((option) => option.value === current)
      ? [{ value: current, label: current }]
      : []),
  ];

  const thinkingOptions: Option<string>[] = thinkingLevels.map((level) => ({
    value: level,
    label: t(`thinking.${level}`),
  }));
  // 比如 auto：omp 支持但这里没有对应文案，原样显示。
  if (typeof thinking === "string" && !thinkingOptions.some((option) => option.value === thinking))
    thinkingOptions.push({ value: thinking, label: thinking });

  const save = (role: string, value: string) => {
    const model = data?.models.find((candidate) => modelKey(candidate.key) === value);
    if (value !== inherit && !model) return;
    saveOmpModelRole(role, model ? model.key : null).catch((error: unknown) => reportError(t, error));
  };

  // 默认模型、思考强度和各角色放在"默认与角色"块的最前面，和 omp 的常用项同一组格子。
  const lead = (
    <>
      <Row label={t("settings.defaultModel")}>
        {(labelId) => (
          <Select
            size="sm"
            width={280}
            value={defaultModel ?? inherit}
            options={optionsFor(t("settings.ompPicksModel"), defaultModel)}
            labelledBy={labelId}
            disabled={data === null || roles === undefined}
            onChange={(value) => save("default", value)}
            testId="setting-default-model"
          />
        )}
      </Row>
      <Row label={t("settings.defaultThinking")}>
        {(labelId) => (
          <Select
            size="sm"
            value={typeof thinking === "string" ? thinking : ""}
            options={thinkingOptions}
            labelledBy={labelId}
            disabled={thinking === undefined}
            onChange={(value) =>
              saveOmpDefaultThinking(value as ThinkingLevel).catch((error: unknown) => reportError(t, error))
            }
            testId="setting-default-thinking"
          />
        )}
      </Row>
      {roleNames.map((role) => {
        const value = roleValues[role];
        const current = typeof value === "string" ? value : null;
        const hint = (builtinRoles as readonly string[]).includes(role) ? role : "custom";
        return (
          <Row
            key={role}
            label={roleLabel(role)}
            info={t("model.roleUse", { hint: t(`model.role.hint.${hint}` as MessageKey) })}
          >
            {(labelId) => (
              <Select
                size="sm"
                width={280}
                value={current ?? inherit}
                options={optionsFor(t("model.roleUnset"), current)}
                labelledBy={labelId}
                disabled={data === null || roles === undefined}
                onChange={(value) => save(role, value)}
                testId={`setting-role-${role}`}
              />
            )}
          </Row>
        );
      })}
    </>
  );
  return <CommonConfig items={common} lead={{ block: "defaults", cells: lead }} />;
}
