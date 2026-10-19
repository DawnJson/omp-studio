// 审批模式胶囊（spec 5.8）：显示和修改的都是 omp 自己的 tools.approvalMode，omp-studio 不另存、启动时不传 --approval-mode。
// omp 的审批模式在进程启动时读一次：改了之后新启动的任务生效，已在运行的任务要重启。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useState } from "react";
import type { ApprovalMode } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, Shield } from "../../icons.tsx";
import { useSettings } from "../../store/index.ts";
import { startupSnapshot } from "../../store/startup-snapshot.ts";
import { ensureOmpConfigLoaded, saveOmpConfigOrThrow, useOmpConfigValue } from "../settings/config-store.ts";
import { Popover } from "./Popover.tsx";

const configKey = "tools.approvalMode";

const modes: readonly { mode: ApprovalMode; label: MessageKey; desc: MessageKey }[] = [
  { mode: "always-ask", label: "approval.alwaysAsk", desc: "approval.desc.alwaysAsk" },
  { mode: "write", label: "approval.write", desc: "approval.desc.write" },
  { mode: "yolo", label: "approval.yolo", desc: "approval.desc.yolo" },
];

export function ApprovalChip() {
  const settings = useSettings();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // 快照还没读到时先用上次读到的（启动缓存），第一帧就显示模式而不是"审批…"。
  const value = useOmpConfigValue(configKey) ?? startupSnapshot().approvalMode;
  const currentEntry = modes.find((entry) => entry.mode === value);
  const current = currentEntry?.mode;

  useEffect(ensureOmpConfigLoaded, []);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  const apply = (mode: ApprovalMode) => {
    setOpen(false);
    setConfirming(false);
    saveOmpConfigOrThrow(configKey, mode).catch((error: unknown) => reportError(t, error));
  };
  const choose = (mode: ApprovalMode) => {
    if (mode === current) close();
    else if (mode === "yolo" && settings?.yoloConfirmed !== true) setConfirming(true);
    else apply(mode);
  };

  return (
    <div className="pop-anchor">
      <button
        type="button"
        className="chip"
        data-testid="approval-chip"
        data-mode={current}
        data-yolo={current === "yolo" || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${t("approval.title")}\n${t("approval.note")}`}
        onClick={() => setOpen((value) => !value)}
      >
        {current === "yolo" && <Shield size={14} />}
        <span className="chip-text">{currentEntry ? t(currentEntry.label) : t("approval.loading")}</span>
      </button>
      <Popover open={open} onClose={close} width={320} label={t("approval.title")}>
        {confirming ? (
          <div className="pop-section">
            <p className="pop-title">{t("approval.yoloConfirmTitle")}</p>
            <p className="pop-note">{t("approval.yoloConfirmBody")}</p>
            <div className="pop-actions">
              <button type="button" className="gate-btn" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </button>
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
                key={entry.mode}
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
            <p className="pop-note">{t("approval.note")}</p>
          </>
        )}
      </Popover>
    </div>
  );
}
