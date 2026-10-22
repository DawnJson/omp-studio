// 设置 → 模型：新任务的默认模型 / 思考强度，以及 omp "模型与推理"组的常用项（模型角色、重试与备用模型），同一张卡。
// 默认值就是 omp 自己的 modelRoles.default / defaultThinkingLevel（设计原则 7），和输入框的模型胶囊、omp 设置是同一份。
// 模型列表来自提供商与账号页同一份读取（accounts-store）。
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
import { ConfigRow } from "./ConfigRow.tsx";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const inherit = "";
// 默认思考强度上面已经有下拉，omp 的同一项不再重复一行。
const shownAbove = ["defaultThinkingLevel"];

const modelKey = (model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`;

export function ModelsSection() {
  const t = useT();
  const roles = useOmpConfigValue("modelRoles");
  const defaultModel = defaultModelRole(roles);
  const thinking = useOmpConfigValue("defaultThinkingLevel");
  const load = useAccountLoad();
  const data = load.kind === "ready" ? load.data : null;
  const common = useCommonConfigItems("models", shownAbove);

  // 有缓存就直接显示，进入时后台刷新一次。
  const enter = useCallback(() => void loadAccounts(), []);
  useEffect(enter, [enter]);
  useEffect(ensureOmpConfigLoaded, []);
  const modelOptions: Option<string>[] = [{ value: inherit, label: t("settings.ompPicksModel") }];
  for (const model of data?.models ?? []) modelOptions.push({ value: modelKey(model.key), label: model.name });
  // modelRoles.default 可能带思考后缀或写成别的形式，也可能已不在列表里：原样保留，别让下拉悄悄显示成别的。
  if (defaultModel && !modelOptions.some((option) => option.value === defaultModel))
    modelOptions.push({ value: defaultModel, label: defaultModel });

  const thinkingOptions: Option<string>[] = thinkingLevels.map((level) => ({
    value: level,
    label: t(`thinking.${level}`),
  }));
  // 比如 auto：omp 支持但这里没有对应文案，原样显示。
  if (typeof thinking === "string" && !thinkingOptions.some((option) => option.value === thinking))
    thinkingOptions.push({ value: thinking, label: thinking });

  // 和 omp 的常用项同一组行。
  return (
    <div className="ui-rows st-rows">
      <Row label={t("settings.defaultModel")}>
        {(labelId) => (
          <Select
            size="sm"
            width={280}
            value={defaultModel ?? inherit}
            options={modelOptions}
            labelledBy={labelId}
            disabled={data === null || roles === undefined}
            onChange={(value) => {
              const model = data?.models.find((candidate) => modelKey(candidate.key) === value);
              if (value !== inherit && !model) return;
              saveOmpModelRole(null, "default", model ? model.key : null).catch((error: unknown) =>
                reportError(t, error),
              );
            }}
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
      {common.map((item) => (
        <ConfigRow key={item.key} item={item} />
      ))}
    </div>
  );
}
