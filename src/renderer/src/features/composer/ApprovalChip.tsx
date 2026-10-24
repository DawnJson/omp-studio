// 审批模式胶囊（spec 5.8）：显示和修改的都是 omp 自己的 tools.approvalMode（按项目目录解析：项目配置盖过全局，见 use-approval-mode.ts），
// omp-studio 不另存、启动时不传 --approval-mode。omp 的审批模式在进程启动时读一次：改了之后新启动的任务生效，已在运行的任务要重启。
// 胶囊 = 图标 + 模式名（ui-chip，全自动用 warning 色）；点开是选择菜单（ui/MenuList，当前项只靠 ✓，第二行写说明）；切到全自动先出行内确认（Popover kind="confirm"）。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState } from "react";
import type { ApprovalMode, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Pencil, Shield, ShieldCheck, ShieldOff } from "../../icons.tsx";
import { useSettings } from "../../store/index.ts";
import { startupSnapshot } from "../../store/startup-snapshot.ts";
import { ensureOmpConfigLoaded } from "../settings/config-store.ts";
import { Button } from "../../ui/controls.tsx";
import { MenuList, type MenuEntry } from "../../ui/Menu.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { useApprovalMode } from "./use-approval-mode.ts";

const modes: readonly { mode: ApprovalMode; label: MessageKey; desc: MessageKey | null; icon: typeof Shield }[] = [
  { mode: "always-ask", label: "approval.alwaysAsk", desc: "approval.desc.alwaysAsk", icon: Shield },
  {
    mode: "always-ask-cached",
    label: "approval.alwaysAskCached",
    desc: "approval.desc.alwaysAskCached",
    icon: ShieldCheck,
  },
  { mode: "write", label: "approval.write", desc: "approval.desc.write", icon: Pencil },
  { mode: "yolo", label: "approval.yolo", desc: null, icon: ShieldOff },
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
  // 还没读到时先用上次读到的全局值（启动缓存），第一帧就显示当前档位的图标和名称。
  const value = approval.info === null ? startupSnapshot().approvalMode : approval.info.mode;
  const currentEntry = modes.find((entry) => entry.mode === value);
  const current = currentEntry?.mode;
  const ModeIcon = currentEntry?.icon ?? Shield;
  const source =
    approval.info === null
      ? ""
      : ` · ${t(approval.info.source === "project" ? "approval.sourceProject" : "approval.sourceGlobal")}`;
  const modeName = currentEntry ? t(currentEntry.label) : t("approval.loading");
  // 胶囊上写模式名；来源（项目配置 / 全局配置）放进悬停提示和 aria-label。
  const chipName = `${t("approval.title")} · ${modeName}${source}`;

  // 项目 .omp/config.yml 设了它：omp 没有写项目层的命令，改全局不生效，所以四档不可选，只在菜单里说明（见 omp-config/approval-mode.ts）。
  const locked = approval.info?.source === "project";

  useEffect(ensureOmpConfigLoaded, []);

  // 菜单打开时焦点落在当前项，↑↓ 才有起点。
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

  const items: MenuEntry[] = [
    // 项目配置锁定：说明只在菜单顶上写一次；四项照常显示自己的第二行，只是灰显不可选。
    ...(locked ? [{ kind: "label" as const, id: "locked", label: t("approval.projectLocked") }] : []),
    ...modes.map((entry) => {
      // 全自动的名字已经说明"不询问"，只补 subagent 这条用户推断不出的后果。
      const desc = entry.desc === null ? t("approval.subagents") : t(entry.desc);
      return {
        id: entry.mode,
        label: t(entry.label),
        // disabledReason 同时是"灰显"开关和第二行的文字；锁定时第二行还是描述本身。
        ...(locked ? { disabledReason: desc } : { note: desc }),
        checked: entry.mode === current,
        testId: `approval-mode-${entry.mode}`,
        onSelect: () => choose(entry.mode),
      };
    }),
    { kind: "separator", id: "sep" },
    {
      id: "forget",
      label: t("approval.forget"),
      note: t("approval.desc.forget"),
      ...(forgetTaskId === null ? { disabledReason: t("approval.forgetUnavailable") } : {}),
      onSelect: forget,
    },
  ];

  return (
    <div className="ui-popover-anchor">
      <button
        type="button"
        className="ui-chip"
        data-testid="approval-chip"
        data-mode={current}
        data-source={approval.info?.source}
        data-tone={current === "yolo" ? "warning" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={chipName}
        title={chipName}
        onClick={() => setOpen((value) => !value)}
      >
        <ModeIcon size={14} />
        <span className="chip-mode">{modeName}</span>
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t("approval.title")}
        kind={confirming ? "confirm" : undefined}
        width={confirming ? undefined : 320}
      >
        {confirming ? (
          <div data-testid="approval-yolo-confirm">
            <p className="ui-pop-title">{t("approval.yoloConfirmTitle")}</p>
            <p className="ui-pop-body">{t("approval.yoloConfirmBody")}</p>
            <div className="ui-pop-actions">
              <Button size="sm" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                testId="approval-yolo-confirm-yes"
                onClick={() => {
                  window.studio.setYoloConfirmed().catch((error: unknown) => reportError(t, error));
                  apply("yolo");
                }}
              >
                {t("approval.yoloConfirmYes")}
              </Button>
            </div>
          </div>
        ) : (
          <div ref={menuRef}>
            <MenuList items={items} label={t("approval.title")} onPicked={() => undefined} />
          </div>
        )}
      </Popover>
    </div>
  );
}
