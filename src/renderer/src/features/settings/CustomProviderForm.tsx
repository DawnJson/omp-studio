// 自定义提供商的添加/编辑表单：ID、Base URL、接口类型、key、模型（CustomModelList）。
// 写 models.yml 在主进程（src/main/omp-config/models-file.ts）；这里只收集输入、把主进程返回的错误码翻成文案。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  formApis,
  isFetchableApi,
  type CustomKeyInput,
  type CustomProviderInfo,
  type CustomProviderInput,
} from "../../../../shared/custom-models.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { describeError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Segmented, Select, type Option } from "./controls.tsx";
import { CustomModelList, type FetchNotice, type ModelRow } from "./CustomModelList.tsx";
import { InfoTip } from "./InfoTip.tsx";
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

function initialKeyMode(provider: CustomProviderInfo | undefined): KeyMode {
  if (provider === undefined) return "literal";
  if (provider.key.kind === "none") return "none";
  return provider.key.kind === "env" ? "env" : "keep";
}

interface CustomProviderFormProps {
  mode: "add" | "edit";
  provider?: CustomProviderInfo;
  onSaved(): void;
  onCancel(): void;
}

export function CustomProviderForm({ mode, provider, onSaved, onCancel }: CustomProviderFormProps) {
  const t = useT();
  const uid = useId();
  const [id, setId] = useState(provider?.id ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [api, setApi] = useState(provider?.api ?? "openai-completions");
  const [keyMode, setKeyMode] = useState<KeyMode>(initialKeyMode(provider));
  const envName = provider?.key.kind === "env" ? provider.key.name : "";
  const [keyText, setKeyText] = useState(envName);
  const [showKey, setShowKey] = useState(false);
  const [rows, setRows] = useState<ModelRow[]>(
    () => provider?.models.map((model) => ({ id: model.id, checked: true })) ?? [],
  );
  const [notice, setNotice] = useState<FetchNotice | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // 拉取/保存期间按钮是禁用的，会丢焦点；结束后焦点还在页面外（body）就放回表单，Esc 才仍然只关这个表单。
  useEffect(() => {
    if (!fetching && !saving && document.activeElement === document.body)
      formRef.current?.focus({ preventScroll: true });
  }, [fetching, saving]);

  const keyInput = (): CustomKeyInput => {
    if (keyMode === "literal") return { kind: "literal", value: keyText };
    if (keyMode === "env") return { kind: "env", name: keyText.trim() };
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

  const selectedCount = rows.filter((row) => row.checked).length;
  const keyReady = (keyMode !== "literal" && keyMode !== "env") || keyText.trim() !== "";
  const canSave =
    (mode === "edit" || id.trim() !== "") &&
    baseUrl.trim() !== "" &&
    keyReady &&
    (selectedCount > 0 || provider?.discovery === true);

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
        ...added.map((model) => ({ id: model.id, ...(model.name !== null && { name: model.name }), checked: false })),
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
      models: rows
        .filter((row) => row.checked)
        .map((row) => ({ id: row.id, ...(row.name !== undefined && { name: row.name }) })),
    };
    try {
      const outcome = await window.studio.saveCustomProvider(mode, input);
      if (outcome.ok) onSaved();
      else setSaveError(customErrorText(t, `err.${outcome.code}`));
    } catch (error) {
      setSaveError(t("custom.saveFailed", { message: describeError(t, error) }));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault(); // 只关表单，不让设置页把这次 Esc 当成"退出设置"
      onCancel();
    }
  };

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      className="st-login cp-form"
      data-testid="custom-provider-form"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !saving) void save();
      }}
    >
      <div className="cp-field">
        <label className="cp-label" htmlFor={`${uid}-id`}>
          {t("custom.form.id")}
          <InfoTip>{t("custom.form.id.tip")}</InfoTip>
        </label>
        <input
          id={`${uid}-id`}
          className="st-input"
          data-mono
          autoComplete="off"
          spellCheck={false}
          value={id}
          disabled={mode === "edit"}
          autoFocus={mode === "add"}
          placeholder="my-proxy"
          data-testid="custom-id"
          onChange={(event) => setId(event.target.value)}
        />
      </div>
      <div className="cp-field">
        <label className="cp-label" htmlFor={`${uid}-url`}>
          {t("custom.form.baseUrl")}
        </label>
        <input
          id={`${uid}-url`}
          className="st-input"
          data-mono
          autoComplete="off"
          spellCheck={false}
          value={baseUrl}
          placeholder={t("custom.form.baseUrl.placeholder")}
          data-testid="custom-base-url"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div className="cp-field">
        <span className="cp-label" id={`${uid}-api`}>
          {t("custom.form.api")}
        </span>
        <div className="cp-control">
          <Select value={api} options={apiOptions} labelledBy={`${uid}-api`} onChange={setApi} testId="custom-api" />
        </div>
      </div>
      <div className="cp-field">
        <span className="cp-label" id={`${uid}-key`}>
          {t("custom.form.key")}
          <InfoTip>{t("custom.form.key.tip")}</InfoTip>
        </span>
        <div className="cp-control cp-key">
          <Segmented
            value={keyMode}
            options={keyOptions}
            labelledBy={`${uid}-key`}
            onChange={(next) => {
              setKeyMode(next);
              setKeyText(next === "env" ? envName : "");
            }}
            testId="custom-key-mode"
          />
          {(keyMode === "literal" || keyMode === "env") && (
            <div className="cp-key-input">
              <input
                className="st-input"
                data-mono
                type={keyMode === "literal" && !showKey ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={keyText}
                placeholder={
                  keyMode === "literal"
                    ? t("custom.form.key.literal.placeholder")
                    : t("custom.form.key.env.placeholder")
                }
                aria-label={t("custom.form.key")}
                data-testid="custom-key"
                onChange={(event) => setKeyText(event.target.value)}
              />
              {keyMode === "literal" && (
                <Button variant="text" onClick={() => setShowKey((shown) => !shown)} testId="custom-key-toggle">
                  {showKey ? t("custom.form.key.hide") : t("custom.form.key.show")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="cp-field cp-models-field">
        <span className="cp-label">{t("custom.form.models")}</span>
        <CustomModelList
          rows={rows}
          onRows={setRows}
          notice={notice}
          onNotice={setNotice}
          fetching={fetching}
          fetchDisabled={baseUrl.trim() === "" || !isFetchableApi(api)}
          onFetch={() => void fetchModels()}
        />
      </div>

      {saveError !== null && (
        <div className="st-error-text" role="alert" data-testid="custom-save-error">
          {saveError}
        </div>
      )}
      <div className="st-login-actions cp-actions">
        <Button variant="primary" disabled={!canSave} loading={saving} onClick={() => void save()} testId="custom-save">
          {t("custom.form.save")}
        </Button>
        <Button variant="text" onClick={onCancel} testId="custom-cancel">
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
