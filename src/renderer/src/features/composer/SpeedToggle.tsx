// 模型选择对话框底部的"速度"：快速模式、慢速模式两组开/关分段（一行内排开，说明放悬停提示），数据和动作都来自 omp（set_fast_mode / set_slow_mode）。
import { useId } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Segmented } from "../../ui/controls.tsx";
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
  return (
    <div className="mp-speed-row" title={hint === null ? undefined : t(hint)}>
      <span id={id} className="mp-ctl-label">
        {t(label)}
      </span>
      <Segmented<"on" | "off">
        size="sm"
        labelledBy={id}
        value={enabled ? "on" : "off"}
        options={[
          { value: "off", label: t("model.off") },
          { value: "on", label: t("model.on") },
        ]}
        onChange={(next) => onChange(next === "on")}
      />
    </div>
  );
}

export function SpeedToggle({ speed }: { speed: SpeedControls }) {
  const t = useT();
  const report = (error: unknown) => reportOmpError(t, error);
  const { fast, slow } = speed;
  return (
    <div className="mp-speed" data-testid="speed-controls">
      <OnOff
        label="model.fast"
        hint="model.fast.hint"
        enabled={fast.enabled}
        onChange={(enabled) => speed.setFast(enabled).catch(report)}
      />
      {slow.supported && (
        <OnOff
          label="model.slow"
          hint={slow.scope === null ? null : slowScopeKey[slow.scope]}
          enabled={slow.enabled}
          onChange={(enabled) => speed.setSlow(enabled).catch(report)}
        />
      )}
    </div>
  );
}
