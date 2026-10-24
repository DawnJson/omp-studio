// 模型选择器里的"预设"一行（/modelpreset）：下拉列出配置项 modelPresets 里的预设，选一个就应用（`/modelpreset switch`：omp 像模型选择器一样把各角色的模型写进配置，并切换当前会话；见 omp models.md）；
// "把当前设置存为预设…"输入名字后保存（`/modelpreset save`，omp 自己写全局配置）。switch 的名字可以含单个空格（omp 18.12.5 实测：参数按空白切开再用单个空格拼回）；
// 只有连续空格、首尾空白、控制字符的名字 omp 找不到，这种预设仍在下拉里，选了不执行，第二行写原因。
import { useEffect, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { listModelPresets, presetNameUsable, presetRefUsable } from "../../../../shared/omp-output/toggles.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, TextField } from "../../ui/controls.tsx";
import { reportOmpError } from "../../ui/errors.ts";
import { Select } from "../../ui/Select.tsx";
import { ensureOmpConfigLoaded, loadOmpConfig, useOmpConfigValue } from "../settings/config-store.ts";
import { runToggleCommand } from "./toggle-actions.ts";
import "./toggles.css";

export function PresetSection({ taskId, onApplied }: { taskId: TaskId; onApplied?: () => void }) {
  const t = useT();
  const presets = listModelPresets(useOmpConfigValue("modelPresets"));
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  useEffect(ensureOmpConfigLoaded, []);

  const run = (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    job()
      .catch((error: unknown) => reportOmpError(t, error))
      .finally(() => setBusy(false));
  };

  const apply = (preset: string) =>
    run(async () => {
      await runToggleCommand(taskId, { kind: "modelPreset", op: "switch", name: preset });
      // omp 把预设里各角色的模型写进了配置：重读快照（设置页、角色表跟着更新）。
      await loadOmpConfig();
      onApplied?.();
    });

  const save = () => {
    const trimmed = name.trim();
    if (!presetNameUsable(trimmed)) {
      setInvalid(true);
      return;
    }
    run(async () => {
      await runToggleCommand(taskId, { kind: "modelPreset", op: "save", name: trimmed });
      // omp 写了全局配置：重读快照，列表里就有新预设（设置页的 omp 分组也跟着更新）。
      await loadOmpConfig();
      setNaming(false);
      setName("");
    });
  };

  return (
    <div className="mp-ctl" data-testid="model-presets">
      <span className="mp-ctl-label">{t("toggles.presets")}</span>
      <div className="tg-presets">
        <div className="tg-preset-row">
          {naming ? (
            <>
              <TextField
                size="sm"
                width="100%"
                className="tg-preset-name"
                testId="model-preset-name"
                aria-label={t("toggles.presets.name")}
                placeholder={t("toggles.presets.name")}
                value={name}
                maxLength={100}
                invalid={invalid}
                autoFocus
                onChange={(next) => {
                  setName(next);
                  setInvalid(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
                    event.preventDefault();
                    save();
                  }
                }}
              />
              <Button size="sm" onClick={() => setNaming(false)}>
                {t("toggles.presets.cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                testId="model-preset-save"
                disabled={busy || name.trim() === ""}
                onClick={save}
              >
                {t("toggles.presets.saveConfirm")}
              </Button>
            </>
          ) : (
            <>
              {presets.length > 0 && (
                <Select<string>
                  size="sm"
                  value=""
                  label={t("toggles.presets")}
                  placeholder={t("toggles.presets.choose")}
                  testId="model-preset-select"
                  disabled={busy}
                  options={presets.map((preset) => {
                    const summary = [preset.model, preset.thinkingLevel].filter((part) => part !== null).join(" · ");
                    return {
                      value: preset.name,
                      label: preset.name,
                      note: presetRefUsable(preset.name) ? summary || undefined : t("toggles.presets.nameUnusable"),
                    };
                  })}
                  onChange={(preset) => {
                    if (presetRefUsable(preset)) apply(preset);
                  }}
                />
              )}
              <Button
                variant="quiet"
                size="sm"
                testId="model-preset-new"
                disabled={busy}
                onClick={() => setNaming(true)}
              >
                {t("toggles.presets.save")}
              </Button>
            </>
          )}
        </div>
        {invalid && (
          <p className="ui-help" data-tone="error">
            {t("toggles.presets.nameInvalid")}
          </p>
        )}
      </div>
    </div>
  );
}
