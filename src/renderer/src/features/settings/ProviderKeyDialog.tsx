// 设置 → 自定义 provider：只改一个条目的 `apiKey`（只覆盖 omp 内置 provider 的条目，比如 `anthropic` 下只有 `modelOverrides`）。
// 这种条目没有 baseUrl 和模型，编辑表单存不了；这里只写 key，条目里别的键由主进程原样保留（models-file.ts 的 applyKey）。
import { useState } from "react";
import { defaultEnvName, type CustomProviderInfo } from "../../../../shared/custom-models.ts";
import { describeError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { customErrorText, KeyFields, keyComplete, useEnvSource, warnIfShadowed } from "./CustomProviderForm.tsx";

type Mode = "literal" | "env";

interface ProviderKeyDialogProps {
  provider: CustomProviderInfo;
  onSaved(): void;
  /** 对话框退出动画放完、卸载时调用。 */
  onClose(): void;
}

export function ProviderKeyDialog({ provider, onSaved, onClose }: ProviderKeyDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const envName = provider.key.kind === "env" ? provider.key.name : "";
  const [mode, setMode] = useState<Mode>(provider.key.kind === "env" ? "env" : "literal");
  const [text, setText] = useState(envName);
  const [envValue, setEnvValue] = useState("");
  const source = useEnvSource(text, mode === "env");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: Option<Mode>[] = [
    { value: "literal", label: t("custom.form.key.literal") },
    { value: "env", label: t("custom.form.key.env") },
  ];
  const canSave = keyComplete(mode, text, envValue, source) && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const outcome = await window.studio.setCustomProviderKey(
        provider.id,
        mode === "literal"
          ? { kind: "literal", value: text }
          : { kind: "env", name: text.trim(), value: envValue.trim() },
      );
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
      title={t("custom.keyEdit.title", { id: provider.id })}
      testId="custom-key-dialog"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={() => void save()}
            testId="custom-key-save"
          >
            {t("custom.form.save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <FormField label={t("custom.form.key")} help={t("custom.keyEdit.tip", { id: provider.id })}>
          <Segmented
            value={mode}
            options={options}
            label={t("custom.form.key")}
            onChange={(next) => {
              setMode(next);
              setText(next === "env" ? (envName !== "" ? envName : defaultEnvName(provider.id)) : "");
              setEnvValue("");
            }}
            testId="custom-key-dialog-mode"
          />
          <KeyFields
            mode={mode}
            modes={options.map((option) => option.value)}
            text={text}
            onText={setText}
            envValue={envValue}
            onEnvValue={setEnvValue}
            source={source}
            testId="custom-key-dialog-value"
          />
        </FormField>
        {error !== null && (
          <Notice tone="error" testId="custom-key-dialog-error">
            {error}
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
