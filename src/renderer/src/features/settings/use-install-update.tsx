// "重启并安装"的唯一实现：侧栏的新版本标签、设置 → 关于、关于对话框三处共用。
// 有任务在进行（running / needs_you）时先弹确认框，说明重启会中断它们；没有就直接安装。安装失败一律弹 toast（全仓的做法，见 ui/errors.ts）。
import { useState, type ReactNode } from "react";
import { useT } from "../../i18n/use-t.ts";
import { useTasks } from "../../store/index.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { useDialogSlot } from "../../ui/presence.ts";

export interface InstallUpdate {
  /** 用户要求安装：必要时先确认。 */
  requestInstall(): void;
  /** installUpdate 已发出（成功时应用随即退出，所以不会自己变回 false）；失败后变回 false。 */
  busy: boolean;
  /** 确认框：调用方渲染在自己的 JSX 里。 */
  dialog: ReactNode;
}

export function useInstallUpdate(): InstallUpdate {
  const t = useT();
  const tasks = useTasks();
  const [busy, setBusy] = useState(false);
  // 确认框用 slot：退出动画没放完又点一次也能立刻开新的（LESSONS「界面」）。值是打开时正在进行的任务数。
  const { slot, open, closed } = useDialogSlot<number>();

  const install = async () => {
    setBusy(true);
    try {
      await window.studio.installUpdate();
    } catch (error) {
      reportError(t, error, (message) => t("settings.about.installFailed", { message }));
      setBusy(false);
    }
  };

  const requestInstall = () => {
    const inProgress = tasks.filter((task) => task.status === "running" || task.status === "needs_you").length;
    if (inProgress === 0) void install();
    else open(inProgress);
  };

  const dialog = slot !== null && (
    <ConfirmDialog
      key={slot.key}
      testId="update-install-dialog"
      title={t("settings.about.installConfirmTitle", { count: slot.value })}
      body={t("settings.about.installConfirmBody")}
      confirmLabel={t("settings.about.install")}
      cancelLabel={t("settings.about.installLater")}
      onConfirm={() => {
        closed(slot.key);
        void install();
      }}
      onCancel={() => closed(slot.key)}
    />
  );

  return { requestInstall, busy, dialog };
}
