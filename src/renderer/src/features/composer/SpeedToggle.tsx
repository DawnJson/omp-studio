// 模型选择对话框右栏里的"速度"：快速模式、慢速模式两组开/关分段，数据和动作都来自 omp（set_fast_mode / set_slow_mode）。
import { useId, type KeyboardEvent } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { reportOmpError } from "../../ui/errors.ts";
import { slowScopeKey } from "./speed-limit-format.ts";

/** 任务里的速度开关；草稿（还没有任务）里没有，ModelPicker 不显示这一节。 */
export interface SpeedControls {
  fast: TaskState["fastMode"];
  slow: TaskState["slowMode"];
  setFast(enabled: boolean): Promise<void>;
  setSlow(enabled: boolean): Promise<void>;
}

function OnOff({
  label,
  hint,
  enabled,
  onChange,
}: {
  label: MessageKey;
  hint: MessageKey | null;
  enabled: boolean;
  onChange(enabled: boolean): void;
}) {
  const t = useT();
  const id = useId();
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onChange(event.key === "ArrowRight");
  };
  return (
    <div className="mp-speed-row">
      <p className="pop-grouprow">
        <span id={id}>{t(label)}</span>
      </p>
      <div className="segments" role="radiogroup" aria-labelledby={id} onKeyDown={onKey}>
        {([false, true] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={enabled === value}
            tabIndex={enabled === value ? 0 : -1}
            className="segment"
            data-checked={enabled === value || undefined}
            onClick={() => onChange(value)}
          >
            {t(value ? "model.on" : "model.off")}
          </button>
        ))}
      </div>
      {hint !== null && <p className="mp-speed-hint">{t(hint)}</p>}
    </div>
  );
}

export function SpeedToggle({ speed }: { speed: SpeedControls }) {
  const t = useT();
  const report = (error: unknown) => reportOmpError(t, error);
  const { fast, slow } = speed;
  return (
    <div className="mp-speed" data-testid="speed-controls">
      <p className="pop-grouprow">
        <span>{t("model.speed")}</span>
      </p>
      <OnOff
        label="model.fast"
        hint="model.fast.hint"
        enabled={fast.enabled}
        onChange={(enabled) => speed.setFast(enabled).catch(report)}
      />
      {slow.supported ? (
        <OnOff
          label="model.slow"
          hint={slow.scope === null ? null : slowScopeKey[slow.scope]}
          enabled={slow.enabled}
          onChange={(enabled) => speed.setSlow(enabled).catch(report)}
        />
      ) : (
        <p className="mp-speed-hint">{t("model.slow.unsupported")}</p>
      )}
    </div>
  );
}
