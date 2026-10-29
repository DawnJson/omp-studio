// 审批模式胶囊（spec 5.8）：显示和修改的都是 omp 自己的 tools.approvalMode（按项目目录解析：项目配置盖过全局，见 use-approval-mode.ts），
// omp-studio 不另存、启动时不传 --approval-mode。omp 的审批模式在进程启动时读一次：改了之后新启动的任务生效，已在运行的任务要重启。
// 胶囊 = 图标 + 模式名（ui-chip，全自动用 warning 色；还没读到模式时图标 + 骨架条，不写假的省略文字）；点开是选择菜单（ui/MenuList，
// 当前项只靠 ✓，每档的说明放悬停提示，不写第二行）；切到全自动先出行内确认（Popover kind="confirm"，危险样式按钮）。
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
  // 还没读到时先用上次读到的全局值（启动缓存），第一帧就显示当前档位的图标和名称。
  const value = approval.info === null ? startupSnapshot().approvalMode : approval.info.mode;
  const currentEntry = modes.find((entry) => entry.mode === value);
  const current = currentEntry?.mode;
  const ModeIcon = currentEntry?.icon ?? Shield;
  const source =
    approval.info === null
      ? ""
      : ` · ${t(approval.info.source === "project" ? "approval.sourceProject" : "approval.sourceGlobal")}`;
  // 胶囊上写模式名；来源（项目配置 / 全局配置）放进悬停提示和 aria-label。还没读到（也没有启动缓存）时只写"审批模式"。
  const chipName = currentEntry ? `${t("approval.title")} · ${t(currentEntry.label)}${source}` : t("approval.title");

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

  // 每档的说明只在悬停提示里（2026-10-29：菜单里每项第二行的说明是多余的字）；不可用的项灰显，原因也在悬停提示里。
  const items: MenuEntry[] = [
    // 项目配置锁定：说明只在菜单顶上写一次；四项灰显不可选。
    ...(locked ? [{ kind: "label" as const, id: "locked", label: t("approval.projectLocked") }] : []),
    ...modes.map((entry) => ({
      id: entry.mode,
      label: t(entry.label),
      title: t(entry.desc),
      disabled: locked,
      checked: entry.mode === current,
      testId: `approval-mode-${entry.mode}`,
      onSelect: () => choose(entry.mode),
    })),
    { kind: "separator", id: "sep" },
    {
      id: "forget",
      label: t("approval.forget"),
      title: forgetTaskId === null ? t("approval.forgetUnavailable") : t("approval.desc.forget"),
      disabled: forgetTaskId === null,
      onSelect: forget,
    },
  ];

  return (
    <div className="ui-popover-anchor approval-anchor">
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
        aria-busy={currentEntry === undefined || undefined}
        title={chipName}
        onClick={() => setOpen((value) => !value)}
      >
        <ModeIcon size={14} />
        {currentEntry ? (
          <span className="chip-mode">{t(currentEntry.label)}</span>
        ) : (
          <span className="ui-skeleton chip-mode-skeleton" aria-hidden="true" />
        )}
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t("approval.title")}
        kind={confirming ? "confirm" : undefined}
        // 菜单只剩档位名（说明在悬停提示里），240 够放；项目锁定时顶上那行说明要 320（2026-10-29）
        width={confirming ? undefined : locked ? 320 : 240}
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
                variant="danger-solid"
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
