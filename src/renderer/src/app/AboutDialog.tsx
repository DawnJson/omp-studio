// "关于与反馈"对话框（顶栏 ⓘ 按钮和单按 Alt 打开）：名称、版本、一句话说明，加反馈入口（Issues 页、日志文件夹、导出诊断）。
// Esc 或点遮罩关闭，Tab 在框内循环，关闭后焦点回到打开前的元素。
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/use-t.ts";
import { useAppInfo } from "../store/index.ts";
import { reportError } from "../ui/errors.ts";
import { usePresence } from "../ui/presence.ts";
import { useTitleBarDim } from "../ui/title-bar-dim.ts";
import { pushToast } from "../features/dialogs/index.ts";

/** 帮助与反馈的落点：本仓库的 Issues（选模板页）。内测期间仓库私有，内测用户需要先被加为协作者才能打开。 */
const helpUrl = "https://github.com/DawnJson/omp-studio/issues/new/choose";

export function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT();
  const presence = usePresence(open);
  useTitleBarDim(open);
  const appInfo = useAppInfo();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState(false);

  // 焦点在 open 变化时立即处理，不等退出动画放完。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      if (await window.studio.exportDiagnostics()) pushToast({ message: t("settings.about.exported") });
    } catch (error) {
      reportError(t, error);
    } finally {
      setExporting(false);
    }
  };

  // Tab 只在对话框内的按钮之间循环。
  const trapTab = (shift: boolean) => {
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (shift ? active === first : active === last) (shift ? last : first).focus();
    else buttons[buttons.indexOf(active as HTMLButtonElement) + (shift ? -1 : 1)]?.focus();
  };

  if (!presence.mounted) return null;

  return (
    <div className="scrim" data-closing={presence.closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="about"
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
        <h2 id="about-title" className="about-title">
          {t("shell.appName")} <span className="about-version">{appInfo?.version ?? ""}</span>
        </h2>
        <p className="about-text">{t("window.aboutTagline")}</p>
        <section className="about-feedback" aria-labelledby="about-feedback-title" data-testid="about-feedback">
          <h3 id="about-feedback-title" className="about-heading">
            {t("window.feedbackTitle")}
          </h3>
          <p className="about-text">{t("window.feedbackDesc")}</p>
          <div className="about-actions">
            <button
              type="button"
              className="button"
              data-testid="about-help"
              onClick={() => void window.studio.openExternal(helpUrl).catch((error: unknown) => reportError(t, error))}
            >
              {t("menu.helpFeedback")}
            </button>
            <button
              type="button"
              className="button"
              data-testid="about-open-logs"
              onClick={() => void window.studio.openLogsFolder().catch((error: unknown) => reportError(t, error))}
            >
              {t("settings.about.openLogs")}
            </button>
            <button
              type="button"
              className="button"
              data-testid="about-export-diagnostics"
              disabled={exporting}
              onClick={() => void exportDiagnostics()}
            >
              {t("window.exportDiagnostics")}
            </button>
          </div>
        </section>
        <button ref={closeRef} type="button" className="button about-close" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
