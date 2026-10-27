// "关于与反馈"对话框（命令面板"关于与反馈"打开；设置 → 关于是完整页）。ui/Dialog sm：标志、版本（带上 omp 的版本）、更新状态，
// 页脚右对齐两个动作——复制版本信息（报问题时贴，运行时版本只在这里面）、报告问题。日志和诊断信息在设置 → 关于。
// Esc、右上角 ×、点遮罩关闭，Tab 在框内循环，关闭后焦点回到打开前的元素。
// 只在打开时挂载（父级用 useDialogSlot 记这一次）：关着时不订阅更新进度、任务表这些很密的事件。
import { useState } from "react";
import { markHeight, markWidth } from "../../../shared/ui/pixel-pi.ts";
import { pushToast } from "../features/dialogs/index.ts";
import { updateStatusText } from "../features/settings/update-status.ts";
import { useInstallUpdate } from "../features/settings/use-install-update.tsx";
import { useT } from "../i18n/use-t.ts";
import { useAppInfo, useOmpStatus, useUpdateState } from "../store/index.ts";
import { Button } from "../ui/controls.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { reportError } from "../ui/errors.ts";
import { PiMark } from "../ui/PiMark.tsx";

/** 报告问题的落点：本仓库的 Issues（选模板页）。 */
const issuesUrl = "https://github.com/DawnJson/omp-studio/issues/new/choose";

/** 标志每像素占几个 CSS 像素。 */
const MARK_SCALE = 4;

export function AboutDialog({ onExited }: { onExited(): void }) {
  const [open, setOpen] = useState(true);
  const t = useT();
  const appInfo = useAppInfo();
  const ompStatus = useOmpStatus();
  const update = useUpdateState();
  const [busy, setBusy] = useState(false);
  const installing = useInstallUpdate();

  const ompVersion = ompStatus?.state === "ready" ? ompStatus.version : null;
  const version = appInfo?.version ?? "—";

  // 复制的是给报问题用的纯文本：标签固定英文（和 VS Code 一样，贴进 issue 谁都看得懂），不带 omp 的路径（里面有用户名）。
  const copyInfo = () => {
    const lines = [
      `omp-studio: ${version}`,
      `omp: ${ompVersion ?? "not found"}`,
      `Electron: ${appInfo?.runtime.electron ?? "—"}`,
      `Chromium: ${appInfo?.runtime.chromium ?? "—"}`,
      `Node: ${appInfo?.runtime.node ?? "—"}`,
      `OS: ${appInfo?.platform ?? "—"}`,
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(
      () => pushToast({ message: t("common.copied") }),
      (cause: unknown) => reportError(t, cause),
    );
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportError(t, error);
    } finally {
      setBusy(false);
    }
  };

  // 更新：开发版、免安装版和没配更新源时不显示这一行（原因在设置 → 关于里说）。
  const showUpdate = update !== null && update.phase !== "disabled";
  const canCheck = update?.phase === "idle" || update?.phase === "up-to-date" || update?.phase === "error";

  return (
    <>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        onExited={onExited}
        size="sm"
        title={t("shell.appName")}
        testId="about-dialog"
        footer={
          <>
            <Button onClick={copyInfo} testId="about-copy-info">
              {t("window.aboutCopyInfo")}
            </Button>
            <Button
              onClick={() =>
                void window.studio.openExternal(issuesUrl).catch((error: unknown) => reportError(t, error))
              }
              testId="about-report"
            >
              {t("window.aboutReportIssue")}
            </Button>
          </>
        }
      >
        <div className="about-body">
          <svg
            className="about-mark"
            viewBox={`0 0 ${markWidth} ${markHeight}`}
            width={markWidth * MARK_SCALE}
            height={markHeight * MARK_SCALE}
            shapeRendering="crispEdges"
            aria-hidden="true"
          >
            <PiMark />
          </svg>
          <p className="about-meta" data-testid="about-version">
            {version}
            <span aria-hidden="true"> · </span>
            {ompVersion === null ? t("window.aboutOmpMissing") : t("window.aboutOmp", { version: ompVersion })}
          </p>
          {showUpdate && (
            <div className="about-update" data-testid="about-update">
              <span>{updateStatusText(update, t)}</span>
              {update.phase === "downloaded" ? (
                <Button
                  variant="primary"
                  size="sm"
                  loading={installing.busy}
                  onClick={installing.requestInstall}
                  testId="about-update-install"
                >
                  {t("settings.about.install")}
                </Button>
              ) : (
                canCheck && (
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() => void run(() => window.studio.checkForUpdate())}
                    testId="about-update-check"
                  >
                    {t("settings.about.check")}
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      </Dialog>
      {installing.dialog}
    </>
  );
}
