// 自定义提供商的添加 / 编辑对话框：ID、Base URL、接口类型、key、模型（CustomModelList）。
// 写 models.yml（和环境变量形式的 key 写进的 agent 目录 `.env`）在主进程（src/main/omp-config/models-file.ts）；
// 这里只收集输入、把主进程返回的错误码翻成文案。
import { useEffect, useId, useState } from "react";
import {
  defaultDiscoveryType,
  defaultEnvName,
  formApis,
  isFetchableApi,
  isValidEnvName,
  parseTokenCount,
  type CustomKeyInput,
  type CustomModelMeta,
  type CustomModelsOutcome,
  type CustomProviderInfo,
  type CustomProviderInput,
  type EnvSource,
} from "../../../../shared/custom-models.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { describeError, reportErrorNow } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { Reserve } from "../../ui/Reserve.tsx";
import { useAccountLoad } from "./accounts-store.ts";
import { CustomModelList, type FetchNotice, type ModelRow } from "./CustomModelList.tsx";
import { setFetchFailure, type FetchFailure } from "./custom-models-store.ts";
import { useAsyncAction } from "./use-async-action.ts";
import "./custom-providers.css";

/** 接口类型的名字（协议名，不翻译）和这种接口常见的服务（`custom.api.<api>` 第二行小字），以及 Base URL 的示例。 */
const apiLabels: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Gemini",
  "azure-openai-responses": "Azure OpenAI",
  "bedrock-converse-stream": "Amazon Bedrock",
};
const baseUrlExamples: Record<string, string> = {
  "google-generative-ai": "https://generativelanguage.googleapis.com/v1beta",
  "azure-openai-responses": "https://<resource>.openai.azure.com/openai/v1",
  "bedrock-converse-stream": "https://bedrock-runtime.us-east-1.amazonaws.com",
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

export type KeyMode = "keep" | "literal" | "env" | "none";

/**
 * 环境变量形式的 key：变量名现在设在哪（主进程查，只回位置）。名字改动后 200ms 再查；查到之前是 null。
 * `active` 为 false（不是环境变量写法）时不查，返回 null。
 */
export function useEnvSource(name: string, active: boolean): EnvSource | null {
  const [found, setFound] = useState<{ name: string; source: EnvSource } | null>(null);
  const trimmed = name.trim();
  useEffect(() => {
    if (!active || !isValidEnvName(trimmed)) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.studio.envKeySource(trimmed).then((source) => {
        if (live) setFound({ name: trimmed, source });
      }, reportErrorNow);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed, active]);
  if (!active) return null;
  if (!isValidEnvName(trimmed)) return "missing";
  return found?.name === trimmed ? found.source : null;
}

/**
 * 这种写法下 key 填够了没有：直接填要有 key；环境变量要有合法变量名，并且这里填了值、或者变量已经设好（系统 / `.env`）
 * ——否则存进去的是一个哪儿都没设的变量名，omp 拿不到 key；保持不变 / 无需 key 不用填。
 */
export function keyComplete(mode: KeyMode, text: string, envValue: string, source: EnvSource | null): boolean {
  if (mode === "literal") return text.trim() !== "";
  if (mode === "env")
    return isValidEnvName(text.trim()) && (envValue.trim() !== "" || source === "system" || source === "env-file");
  return true;
}

interface KeyFieldsProps {
  mode: KeyMode;
  /** 分段里有的几种写法：按其中最高的那种占位，切换时对话框大小不变。 */
  modes: readonly KeyMode[];
  /** 直接填的 key，或环境变量名。 */
  text: string;
  onText(value: string): void;
  /** 环境变量的值：保存时写进 agent 目录的 `.env`；留空 = 不动 `.env`（变量已经设好时）。 */
  envValue: string;
  onEnvValue(value: string): void;
  /** 变量名现在设在哪（`useEnvSource`）。 */
  source: EnvSource | null;
  /** 输入框 `testId`；环境变量的值是 `${testId}-env-value`，显示切换是 `${testId}-toggle`。 */
  testId: string;
  /** 直接填写那一格的读屏名和说明；默认是自定义 provider 的 key（MCP 的 token 另给）。 */
  literalLabel?: string | undefined;
  literalTip?: string | undefined;
}

/**
 * key 分段下面的输入框和一行说明：直接填 → 一个遮住的框；环境变量 → 变量名 + 值两个框；保持不变 / 无需 key → 没有。
 * 变量已经设好时提示：`.env` 里已有 → 值留空保持；系统环境变量里有 → omp 用系统的。
 */
export function KeyFields({
  mode,
  modes,
  text,
  onText,
  envValue,
  onEnvValue,
  source,
  testId,
  literalLabel,
  literalTip,
}: KeyFieldsProps) {
  const t = useT();
  const [show, setShow] = useState(false);
  const noop = () => undefined;
  const toggle = (live: boolean) => (
    <Button
      size="sm"
      variant="quiet"
      onClick={() => setShow((shown) => !shown)}
      testId={live ? `${testId}-toggle` : undefined}
    >
      {show ? t("custom.form.key.hide") : t("custom.form.key.show")}
    </Button>
  );
  // live = false 时是只占位的那份：没有 testId、不接输入。
  const panel = (which: KeyMode, live: boolean, systemHint: boolean) => {
    if (which === "literal")
      return (
        <>
          <TextField
            mono
            width="100%"
            type={show ? "text" : "password"}
            autoComplete="off"
            value={live ? text : ""}
            aria-label={literalLabel ?? t("custom.form.key")}
            testId={live ? testId : undefined}
            onChange={live ? onText : noop}
            trailing={toggle(live)}
          />
          <p className="ui-help">{literalTip ?? t("custom.form.key.literal.tip")}</p>
        </>
      );
    if (which === "env")
      return (
        <>
          <TextField
            mono
            width="100%"
            autoComplete="off"
            value={live ? text : ""}
            placeholder={t("custom.form.key.env.placeholder")}
            aria-label={t("custom.form.key.env")}
            testId={live ? testId : undefined}
            onChange={live ? onText : noop}
          />
          <TextField
            mono
            width="100%"
            type={show ? "text" : "password"}
            autoComplete="off"
            value={live ? envValue : ""}
            placeholder={
              live && source === "env-file"
                ? t("custom.form.key.envValue.keep")
                : t("custom.form.key.envValue.placeholder")
            }
            aria-label={t("custom.form.key.envValue")}
            testId={live ? `${testId}-env-value` : undefined}
            onChange={live ? onEnvValue : noop}
            trailing={toggle(live)}
          />
          <p className="ui-help" data-testid={live && systemHint ? `${testId}-system` : undefined}>
            {systemHint ? t("custom.form.key.envSystem", { name: text.trim() }) : t("custom.form.key.env.tip")}
          </p>
        </>
      );
    return null;
  };
  const ghosts = modes.flatMap((which) =>
    which === "env" ? [panel("env", false, false), panel("env", false, true)] : [panel(which, false, false)],
  );
  return <Reserve ghosts={ghosts}>{panel(mode, true, mode === "env" && source === "system")}</Reserve>;
}

function initialKeyMode(provider: CustomProviderInfo | undefined): KeyMode {
  if (provider === undefined) return "literal";
  if (provider.key.kind === "none") return "none";
  return provider.key.kind === "env" ? "env" : "keep";
}

export const tokenText = (value: number | null) => (value === null ? "" : String(value));

/** omp 不知道这一项（新模型、还没加载、文件里写了值）时的提示：全 null。 */
export const noHint: CustomModelMeta = { reasoning: null, images: null, contextWindow: null, maxTokens: null };

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
  // 变量名是按 ID 自动补的、用户还没改过：改 ID 时跟着改。
  const [nameTouched, setNameTouched] = useState(envName !== "");
  const envSource = useEnvSource(keyText, keyMode === "env");
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
  const { busy: fetching, run: runFetch } = useAsyncAction((error) =>
    setNotice({ tone: "error", text: describeError(t, error) }),
  );
  const [discovery, setDiscovery] = useState(provider?.discovery ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { busy: saving, run } = useAsyncAction((error) =>
    setSaveError(t("custom.saveFailed", { message: describeError(t, error) })),
  );
  // 连接（Base URL、接口类型、key）的指纹：最近一次拉取用的连接和最后保存的一致时，结果才记到卡片上（custom-models-store）。
  const conn = JSON.stringify([baseUrl, api, keyMode, keyText, envValue]);
  const [initialConn] = useState(conn);
  const [lastFetch, setLastFetch] = useState<{ conn: string; failure: FetchFailure | null } | null>(null);

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

  const apiOptions: SelectOption<string>[] = formApis.map((value) => ({
    value,
    label: apiLabels[value] ?? value,
    note: t(`custom.api.${value}`),
  }));
  if (!apiOptions.some((option) => option.value === api)) apiOptions.push({ value: api, label: api });

  const checkedRows = rows.filter((row) => row.checked);
  const selectedCount = checkedRows.length;
  const countsValid = checkedRows.every(
    (row) => parseTokenCount(row.contextWindow) !== undefined && parseTokenCount(row.maxTokens) !== undefined,
  );
  const keyReady = keyComplete(keyMode, keyText, envValue, envSource);
  // 接口类型改成没有通用发现方式的：开关停用，开着也不写；条目里本来就有 discovery 的照旧能保存（原样保留）。
  const discoverySupported = defaultDiscoveryType(api) !== null || provider?.discovery === true;
  const discoveryOn = discovery && discoverySupported;
  const canSave =
    (mode === "edit" || id.trim() !== "") &&
    baseUrl.trim() !== "" &&
    keyReady &&
    countsValid &&
    (selectedCount > 0 || discoveryOn);

  const fetchModels = () =>
    runFetch(async () => {
      setNotice(null);
      const fetchedConn = conn;
      const outcome = await window.studio.fetchProviderModels({
        baseUrl,
        api,
        key: keyInput(),
        ...(provider !== undefined && { providerId: provider.id }),
      });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: customErrorText(t, `fetchErr.${outcome.code}`, outcome.status) });
        // 接口类型不支持拉取、key 是命令：说明不了 key 和地址能不能用，不记。
        if (outcome.code !== "unsupported" && outcome.code !== "command-key")
          setLastFetch({
            conn: fetchedConn,
            failure: { code: outcome.code, ...(outcome.status !== undefined && { status: outcome.status }) },
          });
        return;
      }
      setLastFetch({ conn: fetchedConn, failure: null });
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
      pushToast({ level: "info", message: t("custom.form.models.fetched", { count: outcome.models.length }) });
    });

  const save = () =>
    run(async () => {
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
      const outcome = await window.studio.saveCustomProvider(mode, input);
      if (outcome.ok) {
        warnIfShadowed(t, outcome);
        if (lastFetch?.conn === conn) setFetchFailure(input.id, lastFetch.failure);
        else if (conn !== initialConn) setFetchFailure(input.id, null); // 连接改了、没再拉取：原来的结果不再适用
        onSaved();
      } else setSaveError(customErrorText(t, `err.${outcome.code}`));
    });

  // 不保存就关：只有拉取用的是文件里原样的连接时，结果才说明得了卡片上的这个 provider。
  const close = () => {
    if (provider !== undefined && lastFetch?.conn === initialConn) setFetchFailure(provider.id, lastFetch.failure);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      onExited={onClose}
      title={mode === "add" ? t("custom.form.title.add") : t("custom.form.title.edit", { id: provider?.id ?? "" })}
      testId="custom-provider-form"
      className="cp-dialog"
      footer={
        <>
          <Button onClick={close} testId="custom-cancel">
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
        <div className="cp-conn">
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
              onChange={(next) => {
                setId(next);
                if (keyMode === "env" && !nameTouched) setKeyText(defaultEnvName(next));
              }}
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
              placeholder={baseUrlExamples[api] ?? t("custom.form.baseUrl.placeholder")}
              testId="custom-base-url"
              onChange={setBaseUrl}
            />
          </FormField>
          <FormField label={t("custom.form.key")}>
            <Segmented
              value={keyMode}
              options={keyOptions}
              label={t("custom.form.key")}
              onChange={(next) => {
                setKeyMode(next);
                setKeyText(next === "env" ? (envName !== "" ? envName : defaultEnvName(id)) : "");
                setNameTouched(next === "env" && envName !== "");
                setEnvValue("");
              }}
              testId="custom-key-mode"
            />
            <KeyFields
              mode={keyMode}
              modes={keyOptions.map((option) => option.value)}
              text={keyText}
              onText={(next) => {
                setKeyText(next);
                if (keyMode === "env") setNameTouched(true);
              }}
              envValue={envValue}
              onEnvValue={setEnvValue}
              source={envSource}
              testId="custom-key"
            />
          </FormField>
        </div>
        <FormField className="cp-models-field" label={t("custom.form.models")}>
          <CustomModelList
            rows={rows}
            onRows={setRows}
            hintOf={hintOf}
            notice={notice}
            onNotice={setNotice}
            fetch={{
              busy: fetching,
              disabled: baseUrl.trim() === "" || !isFetchableApi(api),
              run: () => void fetchModels(),
            }}
            discovery={{ on: discoveryOn, supported: discoverySupported, onChange: setDiscovery }}
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
