// 设置 → 模型与账号：提供商列表（登录/API key）、新任务的默认模型/思考强度/审批模式。
// 默认值写的是 omp-studio 自己的偏好（StudioSettings），不写 ~/.omp。
import { describeError } from "../../ui/errors.ts";
import { useCallback, useEffect, useState } from "react";
import type { ApprovalMode, ModelOption } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Card, Select, SettingRow, type Option } from "./controls.tsx";
import { ProviderRow } from "./ProviderRow.tsx";

interface AccountData {
  providers: LoginProvider[];
  accounts: Record<string, LogoutAccount[]>;
  keyProviders: string[];
  models: ModelOption[];
}

const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const approvalModes = ["always-ask", "write", "yolo"] as const;
const approvalLabels = { "always-ask": "approval.alwaysAsk", write: "approval.write", yolo: "approval.yolo" } as const;
const approvalDescs = {
  "always-ask": "approval.desc.alwaysAsk",
  write: "approval.desc.write",
  yolo: "approval.desc.yolo",
} as const;
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
  const settings = useSettings();
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [confirmYolo, setConfirmYolo] = useState(false);

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

  const defaultModel = settings?.defaultModel ?? null;
  const modelOptions: Option<string>[] = [{ value: inherit, label: t("settings.useOmpDefault") }];
  for (const model of data?.models ?? []) modelOptions.push({ value: modelKey(model.key), label: model.name });
  // 默认模型已经不在列表里（比如退出了那个 provider）：保留当前值，别让下拉悄悄显示成别的。
  if (defaultModel && !modelOptions.some((option) => option.value === modelKey(defaultModel)))
    modelOptions.push({ value: modelKey(defaultModel), label: modelKey(defaultModel) });

  const thinkingOptions: Option<string>[] = [
    { value: inherit, label: t("settings.useOmpDefault") },
    ...thinkingLevels.map((level) => ({ value: level, label: t(`thinking.${level}`) })),
  ];
  const approvalOptions: Option<string>[] = [
    { value: inherit, label: t("settings.useOmpDefault") },
    ...approvalModes.map((mode) => ({ value: mode, label: t(approvalLabels[mode]) })),
  ];
  const approvalValue = settings?.defaultApprovalMode ?? inherit;

  const chooseApproval = (value: string) => {
    // 只有第一次选"全部自动"才确认（spec），确认过的记在设置里。
    if (value === "yolo" && !settings?.yoloConfirmed) setConfirmYolo(true);
    else void window.studio.setDefaultApprovalMode(value === inherit ? null : (value as ApprovalMode));
  };

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
              value={defaultModel ? modelKey(defaultModel) : inherit}
              options={modelOptions}
              labelledBy={labelId}
              disabled={data === null}
              onChange={(value) => {
                const model = data?.models.find((candidate) => modelKey(candidate.key) === value);
                void window.studio.setDefaultModel(model ? model.key : null);
              }}
              testId="setting-default-model"
            />
          )}
        </SettingRow>
        <SettingRow title={t("settings.defaultThinking")}>
          {(labelId) => (
            <Select
              value={
                settings?.defaultThinkingLevel && settings.defaultThinkingLevel !== "inherit"
                  ? settings.defaultThinkingLevel
                  : inherit
              }
              options={thinkingOptions}
              labelledBy={labelId}
              onChange={(value) =>
                void window.studio.setDefaultThinkingLevel(value === inherit ? null : (value as ThinkingLevel))
              }
              testId="setting-default-thinking"
            />
          )}
        </SettingRow>
        <SettingRow
          title={t("settings.defaultApproval")}
          desc={
            settings?.defaultApprovalMode
              ? `${t(approvalDescs[settings.defaultApprovalMode])} · ${t("settings.defaultApproval.desc")}`
              : t("settings.defaultApproval.desc")
          }
        >
          {(labelId) => (
            <Select
              value={approvalValue}
              options={approvalOptions}
              labelledBy={labelId}
              onChange={chooseApproval}
              testId="setting-default-approval"
            />
          )}
        </SettingRow>
      </Card>
      {confirmYolo && (
        <ConfirmDialog
          title={t("approval.yoloConfirmTitle")}
          body={t("approval.yoloConfirmBody")}
          confirmLabel={t("approval.yoloConfirmYes")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            setConfirmYolo(false);
            void window.studio.setYoloConfirmed();
            void window.studio.setDefaultApprovalMode("yolo");
          }}
          onCancel={() => setConfirmYolo(false)}
        />
      )}
    </>
  );
}
