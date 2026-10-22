// 审批模式胶囊（spec 5.8）：显示和修改的都是 omp 自己的 tools.approvalMode（按项目目录解析：项目配置盖过全局，见 use-approval-mode.ts），
// omp-studio 不另存、启动时不传 --approval-mode。omp 的审批模式在进程启动时读一次：改了之后新启动的任务生效，已在运行的任务要重启。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState } from "react";
import type { ApprovalMode, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { MenuItem, onMenuKeyDown } from "../../app/AppMenu.tsx";
import { useT } from "../../i18n/use-t.ts";
import { Pencil, Shield, ShieldCheck, ShieldOff } from "../../icons.tsx";
import { useSettings } from "../../store/index.ts";
import { startupSnapshot } from "../../store/startup-snapshot.ts";
import { ensureOmpConfigLoaded } from "../settings/config-store.ts";
import { Popover } from "../../ui/Popover.tsx";
import { useApprovalMode } from "./use-approval-mode.ts";

const modes: readonly { mode: ApprovalMode; label: MessageKey; desc: MessageKey; icon: typeof Shield }[] = [
  { mode: "always-ask", label: "approval.alwaysAsk", desc: "approval.desc.alwaysAsk", icon: Shield },
  {
    mode: "always-ask-cached",
    label: "approval.alwaysAskCached",
    desc: "approval.desc.alwaysAskCached",
    icon: ShieldCheck,
  },
  { mode: "write", label: "approval.write", desc: "approval.desc.write", icon: Pencil },
  { mode: "yolo", label: "approval.yolo", desc: "approval.desc.yolo", icon: ShieldOff },
];

/**
 * projectId：看哪个项目目录里生效的模式（无项目的聊天为 null，只看全局）。
 * forgetTaskId：「清除已记住的批准」发给哪个任务的 omp 会话（`/forget-approvals`）；null（草稿、还没发过消息的任务）时这一项不可用。
 */
export function ApprovalChip({
  projectId,
  forgetTaskId,
}: {
  projectId: ProjectId | null;
  forgetTaskId: TaskId | null;
}) {
  const settings = useSettings();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const approval = useApprovalMode(projectId);
  // 还没读到时先用上次读到的全局值（启动缓存），第一帧就显示当前档位的图标。
  const value = approval.info === null ? startupSnapshot().approvalMode : approval.info.mode;
  const currentEntry = modes.find((entry) => entry.mode === value);
  const current = currentEntry?.mode;
  const ModeIcon = currentEntry?.icon ?? Shield;
  const source =
    approval.info === null
      ? ""
      : ` · ${t(approval.info.source === "project" ? "approval.sourceProject" : "approval.sourceGlobal")}`;
  // 胶囊只有图标：完整名称（含来源）放进悬停提示和 aria-label（没读到档位时写"审批…"）。
  const chipName = `${t("approval.title")} · ${currentEntry ? t(currentEntry.label) : t("approval.loading")}${source}`;

  // 项目 .omp/config.yml 设了它：omp 没有写项目层的命令，改全局不生效，所以四档不可选，只在提示里说明（见 omp-config/approval-mode.ts）。
  const locked = approval.info?.source === "project";

  useEffect(ensureOmpConfigLoaded, []);

  // 菜单打开时焦点落在当前项（同语言/主题菜单），↑↓ 才有起点。
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || confirming) return;
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)'))?.focus();
  }, [open, confirming]);

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  const apply = (mode: ApprovalMode) => {
    close();
    approval.set(mode).catch((error: unknown) => reportError(t, error));
  };
  const choose = (mode: ApprovalMode) => {
    if (mode === current) close();
    else if (mode === "yolo" && settings?.yoloConfirmed !== true) setConfirming(true);
    else apply(mode);
  };
  const forget = () => {
    if (forgetTaskId === null) return;
    close();
    window.studio
      .sendPrompt(forgetTaskId, { text: "/forget-approvals", whenBusy: "followUp" })
      .catch((error: unknown) => reportError(t, error, t("msg.sendFailed")));
  };

  return (
    <div className="ui-popover-anchor">
      <button
        type="button"
        className="chip"
        data-testid="approval-chip"
        data-mode={current}
        data-source={approval.info?.source}
        data-yolo={current === "yolo" || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={chipName}
        title={chipName}
        onClick={() => setOpen((value) => !value)}
      >
        <ModeIcon size={14} />
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
            {modes.map((entry) => {
              const desc = entry.mode === "yolo" ? `${t(entry.desc)}\n${t("approval.subagents")}` : t(entry.desc);
              return (
                <MenuItem
                  key={entry.mode}
                  checked={entry.mode === current}
                  title={locked ? `${desc}\n${t("approval.projectLocked")}` : desc}
                  disabled={locked}
                  onSelect={() => choose(entry.mode)}
                >
                  {t(entry.label)}
                </MenuItem>
              );
            })}
            <div className="menu-sep" role="separator" />
            <MenuItem title={t("approval.desc.forget")} disabled={forgetTaskId === null} onSelect={forget}>
              {t("approval.forget")}
            </MenuItem>
          </div>
        )}
      </Popover>
    </div>
  );
}
