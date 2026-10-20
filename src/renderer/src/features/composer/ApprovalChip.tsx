// 审批模式胶囊（spec 5.8）：显示和修改的都是 omp 自己的 tools.approvalMode，omp-studio 不另存、启动时不传 --approval-mode。
// omp 的审批模式在进程启动时读一次：改了之后新启动的任务生效，已在运行的任务要重启。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState } from "react";
import type { ApprovalMode } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { MenuItem, onMenuKeyDown } from "../../app/AppMenu.tsx";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown, Shield } from "../../icons.tsx";
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

  // 菜单打开时焦点落在当前项（同语言/主题菜单），↑↓ 才有起点。
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || confirming) return;
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
  }, [open, confirming]);

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
        title={t("approval.title")}
        onClick={() => setOpen((value) => !value)}
      >
        <Shield size={13} />
        <span className="chip-text">{currentEntry ? t(currentEntry.label) : t("approval.loading")}</span>
        <ChevronDown size={12} className="chip-caret" />
      </button>
      <Popover open={open} onClose={close} label={t("approval.title")}>
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
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("approval.title")}
            onKeyDown={(event) => onMenuKeyDown(event, menuRef, close)}
          >
            {modes.map((entry) => (
              <MenuItem
                key={entry.mode}
                checked={entry.mode === current}
                title={entry.mode === "yolo" ? `${t(entry.desc)}\n${t("approval.subagents")}` : t(entry.desc)}
                onSelect={() => choose(entry.mode)}
              >
                {t(entry.label)}
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}
