// 自定义提供商的添加 / 编辑对话框：ID、Base URL、接口类型、key、模型（CustomModelList）。
// 写 models.yml 在主进程（src/main/omp-config/models-file.ts）；这里只收集输入、把主进程返回的错误码翻成文案。
import { useId, useState } from "react";
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
import { Button, FormField, Notice, Segmented, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Select } from "../../ui/Select.tsx";
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

function initialKeyMode(provider: CustomProviderInfo | undefined): KeyMode {
  if (provider === undefined) return "literal";
  if (provider.key.kind === "none") return "none";
  return provider.key.kind === "env" ? "env" : "keep";
}

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
  const [showKey, setShowKey] = useState(false);
  const [rows, setRows] = useState<ModelRow[]>(
    () => provider?.models.map((model) => ({ id: model.id, checked: true })) ?? [],
  );
  const [notice, setNotice] = useState<FetchNotice | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={mode === "add" ? t("custom.form.title.add") : t("custom.form.title.edit", { id: provider?.id ?? "" })}
      testId="custom-provider-form"
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
        <FormField label={t("custom.form.key")} help={t("custom.form.key.tip")}>
          <Segmented
            value={keyMode}
            options={keyOptions}
            label={t("custom.form.key")}
            onChange={(next) => {
              setKeyMode(next);
              setKeyText(next === "env" ? envName : "");
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
        </FormField>
        <FormField label={t("custom.form.models")}>
          <CustomModelList
            rows={rows}
            onRows={setRows}
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
