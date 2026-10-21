// 模型选择器里的"预设"一节（/modelpreset）：列出配置项 modelPresets 里的预设，点一下应用（`/modelpreset switch`：omp 像模型选择器一样把各角色的模型写进配置，并切换当前会话；见 omp models.md）；
// "把当前设置存为预设…"输入名字后保存（`/modelpreset save`，omp 自己写全局配置）。switch 的名字可以含单个空格（omp 18.12.5 实测：参数按空白切开再用单个空格拼回）；
// 只有连续空格、首尾空白、控制字符的名字 omp 找不到，这种预设仍可见，点不了但提示照常对比度显示原因。
import { useEffect, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { listModelPresets, presetNameUsable, presetRefUsable } from "../../../../shared/omp-output/toggles.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportOmpError } from "../../ui/errors.ts";
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
    <div className="tg-presets" data-testid="model-presets">
      <span className="mp-ctl-label">{t("toggles.presets")}</span>
      {presets.length === 0 ? (
        <span className="mp-hint">{t("toggles.presets.empty")}</span>
      ) : (
        <div className="tg-preset-list">
          {presets.map((preset) => {
            const usable = presetRefUsable(preset.name);
            const summary = [preset.model, preset.thinkingLevel].filter((part) => part !== null).join(" · ");
            return (
              <button
                key={preset.name}
                type="button"
                className="tg-preset"
                data-testid={`model-preset-${preset.name}`}
                disabled={busy}
                aria-disabled={!usable || undefined}
                aria-label={t("toggles.presets.apply", { name: preset.name })}
                title={usable ? t("toggles.presets.applyTitle", { summary }) : t("toggles.presets.nameUnusable")}
                onClick={() => usable && apply(preset.name)}
              >
                <span>{preset.name}</span>
                {preset.model !== null && <span className="tg-preset-model">{preset.model}</span>}
              </button>
            );
          })}
        </div>
      )}
      {naming ? (
        <>
          <div className="tg-preset-save">
            <input
              className="tg-preset-input"
              data-testid="model-preset-name"
              aria-label={t("toggles.presets.name")}
              placeholder={t("toggles.presets.name")}
              value={name}
              maxLength={100}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
                  event.preventDefault();
                  save();
                }
              }}
            />
            <button type="button" className="gate-btn" onClick={() => setNaming(false)}>
              {t("toggles.presets.cancel")}
            </button>
            <button
              type="button"
              className="gate-btn"
              data-primary
              data-testid="model-preset-save"
              disabled={busy || name.trim() === ""}
              onClick={save}
            >
              {t("toggles.presets.saveConfirm")}
            </button>
          </div>
          {invalid && <p className="tg-preset-error">{t("toggles.presets.nameInvalid")}</p>}
        </>
      ) : (
        <button
          type="button"
          className="mp-link"
          data-testid="model-preset-new"
          disabled={busy}
          onClick={() => setNaming(true)}
        >
          {t("toggles.presets.save")}
        </button>
      )}
    </div>
  );
}
