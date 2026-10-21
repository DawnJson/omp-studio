// "关于与反馈"对话框（顶栏 ⓘ 按钮和单按 Alt 打开）。照 macOS 标准关于面板、Chrome 的"关于"页、VS Code 的关于框：
// 标志、名称、版本（带上 omp 的版本）、更新状态，两个动作——复制版本信息（报问题时贴，运行时版本只在这里面）、报告问题。
// 日志和诊断信息在设置 → 关于。Esc、右上角 ×、点遮罩关闭，Tab 在框内循环，关闭后焦点回到打开前的元素。
// 打开时焦点放在对话框本身（不落在 × 上，免得一打开就是一圈焦点环），第一下 Tab 到第一个按钮。
import { useEffect, useRef, useState } from "react";
import { markHeight, markWidth } from "../../../shared/ui/pixel-pi.ts";
import { pushToast } from "../features/dialogs/index.ts";
import { Button } from "../features/settings/controls.tsx";
import { updateStatusText } from "../features/settings/update-status.ts";
import "../features/settings/settings.css";
import { Close } from "../icons.tsx";
import { useT } from "../i18n/use-t.ts";
import { useAppInfo, useOmpStatus, useUpdateState } from "../store/index.ts";
import { reportError } from "../ui/errors.ts";
import { PiMark } from "../ui/PiMark.tsx";
import { usePresence } from "../ui/presence.ts";
import { useTitleBarDim } from "../ui/title-bar-dim.ts";

/** 报告问题的落点：本仓库的 Issues（选模板页）。内测期间仓库私有，内测用户需要先被加为协作者才能打开。 */
const issuesUrl = "https://github.com/DawnJson/omp-studio/issues/new/choose";

/** 标志每像素占几个 CSS 像素。 */
const MARK_SCALE = 4;

export function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT();
  const presence = usePresence(open);
  useTitleBarDim(open);
  const appInfo = useAppInfo();
  const ompStatus = useOmpStatus();
  const update = useUpdateState();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  // 焦点在 open 变化时立即处理，不等退出动画放完。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

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

  // Tab 只在对话框内的按钮之间循环。
  const trapTab = (shift: boolean) => {
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement as HTMLButtonElement;
    const index = buttons.indexOf(active);
    if (index === -1 || (shift ? active === first : active === last)) (shift ? last : first).focus();
    else buttons[index + (shift ? -1 : 1)]?.focus();
  };

  if (!presence.mounted) return null;

  // 更新：开发版、免安装版和没配更新源时不显示这一行（原因在设置 → 关于里说）。
  const showUpdate = update !== null && update.phase !== "disabled";
  const canCheck = update?.phase === "idle" || update?.phase === "up-to-date" || update?.phase === "error";

  return (
    <div className="scrim" data-closing={presence.closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="about"
        tabIndex={-1}
        {...presence.exitProps}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        data-testid="about-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Tab") {
            event.preventDefault();
            trapTab(event.shiftKey);
          }
        }}
      >
        <button
          type="button"
          className="tool-btn about-close"
          aria-label={t("common.close")}
          data-testid="about-close"
          onClick={onClose}
        >
          <Close size={14} />
        </button>
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
        <h2 id="about-title" className="about-title">
          {t("shell.appName")}
        </h2>
        <p className="about-meta" data-testid="about-version">
          {t("window.aboutVersion", { version })}
          <span aria-hidden="true"> · </span>
          {ompVersion === null ? t("window.aboutOmpMissing") : t("window.aboutOmp", { version: ompVersion })}
        </p>
        {showUpdate && (
          <div className="about-update" data-testid="about-update">
            <span>{updateStatusText(update, t)}</span>
            {update.phase === "downloaded" ? (
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void run(() => window.studio.installUpdate())}
                testId="about-update-install"
              >
                {t("settings.about.install")}
              </Button>
            ) : (
              canCheck && (
                <Button
                  variant="text"
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
        <div className="about-actions">
          <Button onClick={copyInfo} testId="about-copy-info">
            {t("window.aboutCopyInfo")}
          </Button>
          <Button
            onClick={() => void window.studio.openExternal(issuesUrl).catch((error: unknown) => reportError(t, error))}
            testId="about-report"
          >
            {t("window.aboutReportIssue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
