// 设置 → 自定义 provider：编辑只覆盖 omp 内置 provider 的条目（比如 `anthropic` 下只有 `modelOverrides`）。
// 这种条目没有 baseUrl 和模型，CustomProviderForm 存不了；这里改 `apiKey` 和 `modelOverrides` 里各模型的能力参数，
// 条目里别的键由主进程原样保留（models-file.ts 的 applyOverride）。模型列表是 omp 现在列出的这个 provider 的模型，
// 勾选 = 写一条覆盖项；没写的格子显示 omp 现在用的值。
import { useEffect, useState } from "react";
import {
  defaultEnvName,
  parseTokenCount,
  type CustomModelMeta,
  type CustomProviderInfo,
  type ProviderOverrideInput,
} from "../../../../shared/custom-models.ts";
import { describeError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { useAccountLoad } from "./accounts-store.ts";
import { CustomModelList, type FetchNotice, type ModelRow } from "./CustomModelList.tsx";
import {
  customErrorText,
  KeyFields,
  keyComplete,
  noHint,
  tokenText,
  useEnvSource,
  warnIfShadowed,
  type KeyMode,
} from "./CustomProviderForm.tsx";
import "./custom-providers.css";

interface ProviderOverrideDialogProps {
  provider: CustomProviderInfo;
  onSaved(): void;
  /** 对话框退出动画放完、卸载时调用。 */
  onClose(): void;
}

const emptyRow = (id: string): ModelRow => ({
  id,
  checked: false,
  reasoning: null,
  images: null,
  contextWindow: "",
  maxTokens: "",
});

export function ProviderOverrideDialog({ provider, onSaved, onClose }: ProviderOverrideDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const envName = provider.key.kind === "env" ? provider.key.name : "";
  const [mode, setMode] = useState<KeyMode>(
    provider.key.kind === "none" ? "none" : provider.key.kind === "env" ? "env" : "keep",
  );
  const [text, setText] = useState(envName);
  const [envValue, setEnvValue] = useState("");
  const source = useEnvSource(text, mode === "env");
  // 有覆盖项的模型排在前面，其余按 omp 的顺序；omp 的模型列表还没读到时先只有覆盖项，读到后补上。
  const [rows, setRows] = useState<ModelRow[]>(() =>
    provider.overrides.map((model) => ({
      id: model.id,
      checked: true,
      reasoning: model.reasoning,
      images: model.images,
      contextWindow: tokenText(model.contextWindow),
      maxTokens: tokenText(model.maxTokens),
    })),
  );
  const [notice, setNotice] = useState<FetchNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = useAccountLoad();
  const loaded =
    accounts.kind === "ready" ? accounts.data.models.filter((model) => model.key.provider === provider.id) : [];
  const loadedIds = loaded.map((model) => model.key.modelId).join("\n");
  useEffect(() => {
    if (loadedIds === "") return;
    setRows((current) => {
      const known = new Set(current.map((row) => row.id));
      const missing = loadedIds.split("\n").filter((id) => !known.has(id));
      return missing.length === 0 ? current : [...current, ...missing.map(emptyRow)];
    });
  }, [loadedIds]);

  // "自动"后面显示 omp 现在用的值：只对文件里没写的那一项（写了的话 omp 的值就是文件里的值，换回自动后不再适用）。
  const hintOf = (modelId: string): CustomModelMeta => {
    const live = loaded.find((model) => model.key.modelId === modelId);
    if (live === undefined) return noHint;
    const file = provider.overrides.find((model) => model.id === modelId) ?? noHint;
    return {
      reasoning: file.reasoning === null ? live.reasoning : null,
      images: file.images === null ? live.acceptsImages : null,
      contextWindow: file.contextWindow === null ? live.contextWindow : null,
      maxTokens: file.maxTokens === null ? live.maxTokens : null,
    };
  };

  const options: Option<KeyMode>[] = [];
  if (provider.key.kind === "literal" || provider.key.kind === "command")
    options.push({ value: "keep", label: t("custom.form.key.keep") });
  options.push(
    { value: "literal", label: t("custom.form.key.literal") },
    { value: "env", label: t("custom.form.key.env") },
    { value: "none", label: t("custom.form.key.unset") },
  );

  const checkedRows = rows.filter((row) => row.checked);
  const countsValid = checkedRows.every(
    (row) => parseTokenCount(row.contextWindow) !== undefined && parseTokenCount(row.maxTokens) !== undefined,
  );
  const canSave = keyComplete(mode, text, envValue, source) && countsValid && !saving;

  const keyInput = (): ProviderOverrideInput["key"] => {
    if (mode === "literal") return { kind: "literal", value: text };
    if (mode === "env") return { kind: "env", name: text.trim(), value: envValue.trim() };
    return mode === "keep" ? { kind: "keep" } : null;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const outcome = await window.studio.saveProviderOverride(provider.id, {
        key: keyInput(),
        models: checkedRows.map((row) => ({
          id: row.id,
          reasoning: row.reasoning,
          images: row.images,
          contextWindow: parseTokenCount(row.contextWindow) ?? null,
          maxTokens: parseTokenCount(row.maxTokens) ?? null,
        })),
      });
      if (outcome.ok) {
        warnIfShadowed(t, outcome);
        onSaved();
      } else setError(customErrorText(t, `err.${outcome.code}`));
    } catch (caught) {
      setError(t("custom.saveFailed", { message: describeError(t, caught) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={t("custom.form.title.edit", { id: provider.id })}
      testId="custom-override-dialog"
      className="cp-dialog"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={() => void save()}
            testId="custom-override-save"
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
          if (canSave) void save();
        }}
      >
        <div className="cp-conn">
          <FormField label={t("custom.form.key")} help={t("custom.override.keyTip")}>
            <Segmented
              value={mode}
              options={options}
              label={t("custom.form.key")}
              onChange={(next) => {
                setMode(next);
                setText(next === "env" ? (envName !== "" ? envName : defaultEnvName(provider.id)) : "");
                setEnvValue("");
              }}
              testId="custom-override-key-mode"
            />
            <KeyFields
              mode={mode}
              modes={options.map((option) => option.value)}
              text={text}
              onText={setText}
              envValue={envValue}
              onEnvValue={setEnvValue}
              source={source}
              testId="custom-override-key"
            />
          </FormField>
        </div>
        <FormField className="cp-models-field" label={t("custom.form.models")}>
          <CustomModelList rows={rows} onRows={setRows} hintOf={hintOf} notice={notice} onNotice={setNotice} />
        </FormField>
        {error !== null && (
          <Notice tone="error" testId="custom-override-error">
            {error}
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
