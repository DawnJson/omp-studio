// 设置 → 模型与账号：提供商列表（登录/API key）、新任务的默认模型/思考强度。
// 默认值就是 omp 自己的 modelRoles.default / defaultThinkingLevel（设计原则 7），和输入框的模型胶囊、omp 设置页是同一份。
import { describeError, reportError } from "../../ui/errors.ts";
import { useCallback, useEffect, useState } from "react";
import type { ModelOption } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import {
  defaultModelRole,
  ensureOmpConfigLoaded,
  saveOmpDefaultModel,
  saveOmpDefaultThinking,
  useOmpConfigValue,
} from "./config-store.ts";
import { Card, Select, SettingRow, type Option } from "./controls.tsx";
import { ProviderRow } from "./ProviderRow.tsx";

interface AccountData {
  providers: LoginProvider[];
  accounts: Record<string, LogoutAccount[]>;
  keyProviders: string[];
  models: ModelOption[];
}

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const inherit = "";

/** 一次读全：provider、每个已登录 provider 的账号、已存的 key、模型。provider 或模型读不出来整体失败，由界面显示原因。 */
async function loadAccountData(): Promise<AccountData> {
  const [providers, keyProviders, models] = await Promise.all([
    window.studio.listLoginProviders(),
    window.studio.listApiKeyProviders(),
    window.studio.listModels(),
  ]);
  const accounts: Record<string, LogoutAccount[]> = {};
  await Promise.all(
    providers
      .filter((provider) => provider.authenticated)
      .map(async (provider) => {
        accounts[provider.id] = await window.studio.listAccounts(provider.id);
      }),
  );
  return { providers, accounts, keyProviders, models };
}

const modelKey = (model: { provider: string; modelId: string }) => `${model.provider}/${model.modelId}`;

export function ModelsSection() {
  const t = useT();
  const roles = useOmpConfigValue("modelRoles");
  const defaultModel = defaultModelRole(roles);
  const thinking = useOmpConfigValue("defaultThinkingLevel");
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loginBusy, setLoginBusy] = useState(false);

  const reload = useCallback(() => {
    loadAccountData().then(
      (loaded) => {
        setData(loaded);
        setError(null);
      },
      (failure: unknown) => setError(failure),
    );
  }, []);
  useEffect(reload, [reload]);
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
                saveOmpDefaultModel(model ? model.key : null).catch((error: unknown) => reportError(t, error));
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
