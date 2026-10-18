// 审批模式胶囊（spec 5.8）：每个任务的模式在 omp 进程启动时固定。有进程时只读；草稿和休眠任务（没有进程）可改，下次启动生效。
// null = 跟随 omp：不传 --approval-mode，由 omp 的 tools.approvalMode 决定。
import { reportError } from "../../ui/errors.ts";
import { useState } from "react";
import type { ApprovalMode } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, Shield } from "../../icons.tsx";
import { useSettings } from "../../store/index.ts";
import { Popover } from "./Popover.tsx";

const modes: readonly { mode: ApprovalMode | null; label: MessageKey; desc: MessageKey }[] = [
  { mode: null, label: "approval.followOmp", desc: "approval.desc.followOmp" },
  { mode: "always-ask", label: "approval.alwaysAsk", desc: "approval.desc.alwaysAsk" },
  { mode: "write", label: "approval.write", desc: "approval.desc.write" },
  { mode: "yolo", label: "approval.yolo", desc: "approval.desc.yolo" },
];

export interface ApprovalChipProps {
  mode: ApprovalMode | null;
  /** 有 omp 进程：模式已固定，只读。 */
  locked: boolean;
  onChange(mode: ApprovalMode | null): Promise<void>;
}

export function ApprovalChip({ mode: current, locked, onChange }: ApprovalChipProps) {
  const settings = useSettings();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const currentEntry = modes.find((entry) => entry.mode === current) ?? (modes[0] as (typeof modes)[number]);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  const apply = (mode: ApprovalMode | null) => {
    setOpen(false);
    setConfirming(false);
    onChange(mode).catch((error: unknown) => reportError(t, error));
  };
  const choose = (mode: ApprovalMode | null) => {
    if (mode === "yolo" && settings?.yoloConfirmed !== true) setConfirming(true);
    else apply(mode);
  };

  return (
    <div className="pop-anchor">
      <button
        type="button"
        className="chip"
        data-testid="approval-chip"
        data-yolo={current === "yolo" || undefined}
        data-locked={locked || undefined}
        aria-haspopup={locked ? undefined : "dialog"}
        aria-expanded={locked ? undefined : open}
        title={locked ? t("approval.locked") : t("approval.title")}
        onClick={() => !locked && setOpen((value) => !value)}
      >
        {current === "yolo" && <Shield size={14} />}
        <span className="chip-text">{t(currentEntry.label)}</span>
      </button>
      <Popover open={open && !locked} onClose={close} width={320} label={t("approval.title")}>
        {confirming ? (
          <div className="pop-section">
            <p className="pop-title">{t("approval.yoloConfirmTitle")}</p>
            <p className="pop-note">{t("approval.yoloConfirmBody")}</p>
            <div className="pop-actions">
              <button type="button" className="gate-btn" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
              <button
                type="button"
                className="gate-btn"
                data-primary
                onClick={() => {
                  window.studio.setYoloConfirmed().catch((error: unknown) => reportError(t, error));
                  apply("yolo");
                }}
              >
                {t("approval.yoloConfirmYes")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {modes.map((entry) => (
              <button
                key={entry.mode ?? "omp"}
                type="button"
                className="pop-item"
                role="menuitemradio"
                aria-checked={entry.mode === current}
                title={entry.mode === "yolo" ? `${t(entry.desc)}\n${t("approval.subagents")}` : t(entry.desc)}
                onClick={() => choose(entry.mode)}
              >
                <span className="pop-item-text">{t(entry.label)}</span>
                {entry.mode === current && <Check size={14} />}
              </button>
            ))}
          </>
        )}
      </Popover>
    </div>
  );
}
