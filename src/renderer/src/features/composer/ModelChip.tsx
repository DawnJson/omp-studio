// 模型 + 思考强度合并成一颗胶囊（spec 4.14）。点开是模型选择对话框（ModelPicker）；Alt M / 命令面板也能打开，Alt T 直接轮换思考强度。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown } from "../../icons.tsx";
import { onStudioCommand } from "../palette/index.ts";
import { ModelPicker, thinkingLabel, type ModelPickerProps } from "./ModelPicker.tsx";
import { nextThinkingLevel } from "./thinking-levels.ts";
import { speedBadges } from "./speed-limit-format.ts";

/** 模型胶囊的数据和动作：任务里是 setTask*，草稿（还没有任务）里改的是"新任务默认值"。 */
export interface ModelChipProps extends Omit<ModelPickerProps, "onClose"> {
  /** 没有具体模型时显示什么（缺省"未连接模型"）。 */
  emptyLabel?: string;
}

export function ModelChip(task: ModelChipProps) {
  const t = useT();
  const report = (error: unknown) => reportError(t, error);
  const { emptyLabel, ...pickerProps } = task;
  const [open, setOpen] = useState(false);
  // 调用方已按模型和 omp 的实际能力算好（thinkingLevelOptions）；picker、芯片、Alt T 共用这一份。
  const levels = task.thinkingLevels;
  const supportsThinking = task.model?.reasoning === true && levels.length > 0;
  const levelText =
    task.thinkingLevel && thinkingLabel[task.thinkingLevel] ? t(thinkingLabel[task.thinkingLevel] as MessageKey) : null;
  const name = task.model?.name ?? emptyLabel ?? t("composer.noModel");
  const badges = task.speed ? speedBadges(task.speed.fast, task.speed.slow) : [];

  function cycleThinking(): void {
    if (!supportsThinking) return;
    const next = nextThinkingLevel(levels, task.thinkingLevel);
    if (next) task.setThinking(next).catch(report);
  }

  // 命令面板 / Alt M / Alt T。
  useEffect(() =>
    onStudioCommand((command) => {
      if (command === "model") setOpen(true);
      if (command === "thinking") cycleThinking();
    }),
  );
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        cycleThinking();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <button
        type="button"
        className="chip"
        data-testid="model-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("composer.modelChip")}
        onClick={() => setOpen(true)}
      >
        <span className="chip-text">
          {name}
          {(supportsThinking || !task.model) && levelText ? ` · ${levelText}` : ""}
        </span>
        {badges.map((badge) => (
          <span key={badge} className="chip-badge" data-testid={`speed-badge-${badge}`}>
            {t(badge === "fast" ? "composer.badge.fast" : "composer.badge.slow")}
          </span>
        ))}
        <ChevronDown size={12} />
      </button>
      {open && <ModelPicker {...pickerProps} onClose={() => setOpen(false)} />}
    </>
  );
}
