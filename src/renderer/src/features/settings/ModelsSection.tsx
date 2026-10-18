// 设置 → 模型与账号：提供商列表（登录/API key）、新任务的默认模型/思考强度。
// 默认值就是 omp 自己的 modelRoles.default / defaultThinkingLevel（设计原则 7），和输入框的模型胶囊、omp 设置页是同一份。
import { describeError, reportError } from "../../ui/errors.ts";
import { useCallback, useEffect, useState } from "react";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import {
  defaultModelRole,
  ensureOmpConfigLoaded,
  saveOmpDefaultModel,
  saveOmpDefaultThinking,
  useOmpConfigValue,
} from "./config-store.ts";
import { loadAccounts, useAccountLoad } from "./accounts-store.ts";
import { Card, Select, SettingRow, type Option } from "./controls.tsx";
import { ProviderRow } from "./ProviderRow.tsx";

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const inherit = "";

const modelKey = (model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`;

export function ModelsSection() {
  const t = useT();
  const roles = useOmpConfigValue("modelRoles");
  const defaultModel = defaultModelRole(roles);
  const thinking = useOmpConfigValue("defaultThinkingLevel");
  const load = useAccountLoad();
  const data = load.kind === "ready" ? load.data : null;
  const error = load.kind === "error" ? load.error : null;
  const [loginBusy, setLoginBusy] = useState(false);

  // 有缓存就直接显示，进入时后台刷新一次。
  const enter = useCallback(() => void loadAccounts(), []);
  useEffect(enter, [enter]);
  // 登录/退出/改 key 之后必须重读，不能并进改动之前发起的旧读取。
  const reload = useCallback(() => void loadAccounts(true), []);
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

  return (
    <>
      <h3 className="settings-group-title">{t("login.providers")}</h3>
      <Card testId="providers">
        {error !== null && (
          <div className="st-block st-error-text" role="alert">
            {t("login.loadFailed", { message: describeError(t, error) })}
          </div>
        )}
        {load.kind === "ready" && load.refreshError !== null && (
          <div className="st-block st-muted" role="status" data-testid="providers-refresh-failed">
            {t("login.refreshFailed", { message: describeError(t, load.refreshError) })}
          </div>
        )}
        {error === null && data === null && <div className="st-block st-muted">{t("settings.modelsLoading")}</div>}
        {data?.providers.length === 0 && <div className="st-block st-muted">{t("login.empty")}</div>}
        {data?.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            accounts={data.accounts[provider.id] ?? []}
            hasStoredKey={data.keyProviders.includes(provider.id)}
            canSetKey={apiKeyEnvName(provider.id) !== null}
            blocked={loginBusy}
            onLoginActive={setLoginBusy}
            onChanged={reload}
          />
        ))}
      </Card>

      <Card>
        <SettingRow title={t("settings.defaultModel")}>
          {(labelId) => (
            <Select
              value={defaultModel ?? inherit}
              options={modelOptions}
              labelledBy={labelId}
              disabled={data === null || roles === undefined}
              onChange={(value) => {
                const model = data?.models.find((candidate) => modelKey(candidate.key) === value);
                if (value !== inherit && !model) return;
                saveOmpDefaultModel(null, model ? model.key : null).catch((error: unknown) => reportError(t, error));
              }}
              testId="setting-default-model"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.defaultThinking")}>
          {(labelId) => (
            <Select
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
        </SettingRow>
      </Card>
    </>
  );
}
