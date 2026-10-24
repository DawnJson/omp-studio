// 自定义提供商的添加 / 编辑对话框：ID、Base URL、接口类型、key、模型（CustomModelList）。
// 写 models.yml（和环境变量形式的 key 写进的 agent 目录 `.env`）在主进程（src/main/omp-config/models-file.ts）；
// 这里只收集输入、把主进程返回的错误码翻成文案。
import { useId, useState } from "react";
import {
  defaultDiscoveryType,
  formApis,
  isFetchableApi,
  parseTokenCount,
  type CustomKeyInput,
  type CustomKeyState,
  type CustomModelMeta,
  type CustomModelsOutcome,
  type CustomProviderInfo,
  type CustomProviderInput,
} from "../../../../shared/custom-models.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { describeError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, Switch, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Select } from "../../ui/Select.tsx";
import { useAccountLoad } from "./accounts-store.ts";
import { CustomModelList, type FetchNotice, type ModelRow } from "./CustomModelList.tsx";
import "./custom-providers.css";

type KeyMode = "keep" | "literal" | "env" | "none";

const apiLabels: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

/** 主进程返回的错误码（`err.*` / `fetchErr.*`）→ 当前语言的一句话。 */
export function customErrorText(t: TFunction, code: string, status?: number): string {
  return t(`custom.${code}` as Parameters<TFunction>[0], { status: status ?? "" });
}

/** 写进 `.env` 的变量在系统环境变量里也有：omp 用系统的那个，提醒一句。 */
export function warnIfShadowed(t: TFunction, outcome: CustomModelsOutcome): void {
  if (outcome.ok && outcome.envShadowed !== undefined)
    pushToast({ level: "warning", message: t("custom.form.key.envShadowed", { name: outcome.envShadowed }) });
}

interface EnvValueFieldProps {
  /** 输入框里现在的变量名。 */
  name: string;
  /** 打开对话框时文件里的 key（判断这个变量现在设在哪）。 */
  original: CustomKeyState | undefined;
  value: string;
  onChange(value: string): void;
  testId: string;
}

/**
 * 环境变量形式的 key 的第二个框：key 本身，保存时写进 agent 目录的 `.env`（`变量名=key`）。留空 = 不动 `.env`。
 * 变量名没改时按它现在设在哪提示：`.env` 里已有 → 留空保持；系统环境变量里有 → omp 用系统的，这里写了也不生效。
 */
export function EnvValueField({ name, original, value, onChange, testId }: EnvValueFieldProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  const source = original?.kind === "env" && original.name === name.trim() ? original.source : null;
  return (
    <>
      <TextField
        mono
        width="100%"
        type={show ? "text" : "password"}
        autoComplete="off"
        value={value}
        placeholder={
          source === "env-file" ? t("custom.form.key.envValue.keep") : t("custom.form.key.envValue.placeholder")
        }
        aria-label={t("custom.form.key.envValue")}
        testId={testId}
        onChange={onChange}
        trailing={
          <Button size="sm" variant="quiet" onClick={() => setShow((shown) => !shown)}>
            {show ? t("custom.form.key.hide") : t("custom.form.key.show")}
          </Button>
        }
      />
      {source === "system" && (
        <p className="ui-help" data-testid={`${testId}-system`}>
          {t("custom.form.key.envSystem", { name: name.trim() })}
        </p>
      )}
    </>
  );
}

function initialKeyMode(provider: CustomProviderInfo | undefined): KeyMode {
  if (provider === undefined) return "literal";
  if (provider.key.kind === "none") return "none";
  return provider.key.kind === "env" ? "env" : "keep";
}

const tokenText = (value: number | null) => (value === null ? "" : String(value));

/** omp 不知道这一项（新模型、还没加载、文件里写了值）时的提示：全 null。 */
const noHint: CustomModelMeta = { reasoning: null, images: null, contextWindow: null, maxTokens: null };

interface CustomProviderFormProps {
  mode: "add" | "edit";
  provider?: CustomProviderInfo;
  onSaved(): void;
  /** 对话框退出动画放完、卸载时调用。 */
  onClose(): void;
}

export function CustomProviderForm({ mode, provider, onSaved, onClose }: CustomProviderFormProps) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(true);
  const [id, setId] = useState(provider?.id ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [api, setApi] = useState(provider?.api ?? "openai-completions");
  const [keyMode, setKeyMode] = useState<KeyMode>(initialKeyMode(provider));
  const envName = provider?.key.kind === "env" ? provider.key.name : "";
  const [keyText, setKeyText] = useState(envName);
  const [envValue, setEnvValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [rows, setRows] = useState<ModelRow[]>(
    () =>
      provider?.models.map((model) => ({
        id: model.id,
        checked: true,
        reasoning: model.reasoning,
        images: model.images,
        contextWindow: tokenText(model.contextWindow),
        maxTokens: tokenText(model.maxTokens),
      })) ?? [],
  );
  const [notice, setNotice] = useState<FetchNotice | null>(null);
  const [fetching, setFetching] = useState(false);
  const [discovery, setDiscovery] = useState(provider?.discovery ?? false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // "自动"后面显示 omp 现在用的值：只对已保存、文件里没写这一项的模型（写了的话 omp 的值就是文件里的值，换回自动后不再适用）。
  const accounts = useAccountLoad();
  const loaded = new Map(
    accounts.kind === "ready" && provider !== undefined
      ? accounts.data.models
          .filter((model) => model.key.provider === provider.id)
          .map((model) => [model.key.modelId, model] as const)
      : [],
  );
  const hintOf = (modelId: string): CustomModelMeta => {
    const live = loaded.get(modelId);
    const file = provider?.models.find((model) => model.id === modelId);
    if (live === undefined || file === undefined) return noHint;
    return {
      reasoning: file.reasoning === null ? live.reasoning : null,
      images: file.images === null ? live.acceptsImages : null,
      contextWindow: file.contextWindow === null ? live.contextWindow : null,
      maxTokens: file.maxTokens === null ? live.maxTokens : null,
    };
  };

  const keyInput = (): CustomKeyInput => {
    if (keyMode === "literal") return { kind: "literal", value: keyText };
    if (keyMode === "env") return { kind: "env", name: keyText.trim(), value: envValue.trim() };
    return { kind: keyMode };
  };

  const keyOptions: Option<KeyMode>[] = [];
  if (provider?.key.kind === "literal" || provider?.key.kind === "command")
    keyOptions.push({ value: "keep", label: t("custom.form.key.keep") });
  keyOptions.push(
    { value: "literal", label: t("custom.form.key.literal") },
    { value: "env", label: t("custom.form.key.env") },
    { value: "none", label: t("custom.form.key.none") },
  );

  const apiOptions: Option<string>[] = formApis.map((value) => ({ value, label: apiLabels[value] ?? value }));
  if (!apiOptions.some((option) => option.value === api)) apiOptions.push({ value: api, label: api });

  const checkedRows = rows.filter((row) => row.checked);
  const selectedCount = checkedRows.length;
  const countsValid = checkedRows.every(
    (row) => parseTokenCount(row.contextWindow) !== undefined && parseTokenCount(row.maxTokens) !== undefined,
  );
  const keyReady = (keyMode !== "literal" && keyMode !== "env") || keyText.trim() !== "";
  // 接口类型改成没有通用发现方式的：开关停用，开着也不写；条目里本来就有 discovery 的照旧能保存（原样保留）。
  const discoverySupported = defaultDiscoveryType(api) !== null || provider?.discovery === true;
  const discoveryOn = discovery && discoverySupported;
  const canSave =
    (mode === "edit" || id.trim() !== "") &&
    baseUrl.trim() !== "" &&
    keyReady &&
    countsValid &&
    (selectedCount > 0 || discoveryOn);

  const fetchModels = async () => {
    setFetching(true);
    setNotice(null);
    try {
      const outcome = await window.studio.fetchProviderModels({
        baseUrl,
        api,
        key: keyInput(),
        ...(provider !== undefined && { providerId: provider.id }),
      });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: customErrorText(t, `fetchErr.${outcome.code}`, outcome.status) });
        return;
      }
      const known = new Set(rows.map((row) => row.id));
      const added = outcome.models.filter((model) => !known.has(model.id));
      setRows((current) => [
        ...current,
        ...added.map((model) => ({
          id: model.id,
          ...(model.name !== null && { name: model.name }),
          checked: false,
          reasoning: null,
          images: null,
          contextWindow: "",
          maxTokens: "",
        })),
      ]);
      setNotice({
        tone: "ok",
        text: t("custom.form.models.fetched", { count: outcome.models.length, added: added.length }),
      });
    } catch (error) {
      setNotice({ tone: "error", text: describeError(t, error) });
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const input: CustomProviderInput = {
      id: (provider?.id ?? id).trim(),
      baseUrl,
      api,
      key: keyInput(),
      models: checkedRows.map((row) => ({
        id: row.id,
        ...(row.name !== undefined && { name: row.name }),
        reasoning: row.reasoning,
        images: row.images,
        contextWindow: parseTokenCount(row.contextWindow) ?? null,
        maxTokens: parseTokenCount(row.maxTokens) ?? null,
      })),
      discovery: discoveryOn,
    };
    try {
      const outcome = await window.studio.saveCustomProvider(mode, input);
      if (outcome.ok) {
        warnIfShadowed(t, outcome);
        onSaved();
      } else setSaveError(customErrorText(t, `err.${outcome.code}`));
    } catch (error) {
      setSaveError(t("custom.saveFailed", { message: describeError(t, error) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={mode === "add" ? t("custom.form.title.add") : t("custom.form.title.edit", { id: provider?.id ?? "" })}
      testId="custom-provider-form"
      className="cp-dialog"
      footer={
        <>
          <Button onClick={() => setOpen(false)} testId="custom-cancel">
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={() => void save()}
            testId="custom-save"
          >
            {t("custom.form.save")}
          </Button>
        </>
      }
    >
      <form
        className="cp-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && !saving) void save();
        }}
      >
        <FormField label={t("custom.form.id")} htmlFor={`${uid}-id`} help={t("custom.form.id.tip")}>
          <TextField
            id={`${uid}-id`}
            mono
            width="100%"
            autoComplete="off"
            value={id}
            disabled={mode === "edit"}
            data-autofocus={mode === "add" ? "" : undefined}
            placeholder="my-proxy"
            testId="custom-id"
            onChange={setId}
          />
        </FormField>
        <FormField label={t("custom.form.api")}>
          <Select
            value={api}
            options={apiOptions}
            label={t("custom.form.api")}
            width="100%"
            onChange={setApi}
            testId="custom-api"
          />
        </FormField>
        <FormField label={t("custom.form.baseUrl")} htmlFor={`${uid}-url`}>
          <TextField
            id={`${uid}-url`}
            mono
            width="100%"
            autoComplete="off"
            value={baseUrl}
            placeholder={t("custom.form.baseUrl.placeholder")}
            testId="custom-base-url"
            onChange={setBaseUrl}
          />
        </FormField>
        <FormField label={t("custom.form.key")} help={t("custom.form.key.tip")}>
          <Segmented
            value={keyMode}
            options={keyOptions}
            label={t("custom.form.key")}
            onChange={(next) => {
              setKeyMode(next);
              setKeyText(next === "env" ? envName : "");
              setEnvValue("");
            }}
            testId="custom-key-mode"
          />
          {(keyMode === "literal" || keyMode === "env") && (
            <TextField
              mono
              width="100%"
              type={keyMode === "literal" && !showKey ? "password" : "text"}
              autoComplete="off"
              value={keyText}
              placeholder={
                keyMode === "literal" ? t("custom.form.key.literal.placeholder") : t("custom.form.key.env.placeholder")
              }
              aria-label={t("custom.form.key")}
              testId="custom-key"
              onChange={setKeyText}
              trailing={
                keyMode === "literal" ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setShowKey((shown) => !shown)}
                    testId="custom-key-toggle"
                  >
                    {showKey ? t("custom.form.key.hide") : t("custom.form.key.show")}
                  </Button>
                ) : undefined
              }
            />
          )}
          {keyMode === "env" && (
            <EnvValueField
              name={keyText}
              original={provider?.key}
              value={envValue}
              onChange={setEnvValue}
              testId="custom-key-env-value"
            />
          )}
        </FormField>
        <FormField className="cp-wide" label={t("custom.form.discovery")} help={t("custom.form.discovery.tip")}>
          <Switch
            checked={discoveryOn}
            disabled={!discoverySupported}
            label={t("custom.form.discovery")}
            onChange={setDiscovery}
            testId="custom-discovery"
          />
          {!discoverySupported && <p className="cp-text">{t("custom.form.discovery.unsupported")}</p>}
        </FormField>
        <FormField className="cp-wide" label={t("custom.form.models")} help={t("custom.form.models.tip")}>
          <CustomModelList
            rows={rows}
            onRows={setRows}
            hintOf={hintOf}
            notice={notice}
            onNotice={setNotice}
            fetching={fetching}
            fetchDisabled={baseUrl.trim() === "" || !isFetchableApi(api)}
            onFetch={() => void fetchModels()}
          />
        </FormField>
        {saveError !== null && (
          <Notice tone="error" testId="custom-save-error">
            {saveError}
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
