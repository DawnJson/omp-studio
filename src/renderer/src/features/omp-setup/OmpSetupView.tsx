// omp 准备页（spec §4.22）：盖在应用上的居中卡片，只在需要用户参与或在等待时出现；omp 就绪后自己消失。
// 状态来自 store 的 OmpStatus：检测中、问接管、下载中、出错、脚本启动不了。
// 导出名和 props 是 App.tsx 的约定（始终渲染，由本组件决定要不要显示）。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useId, useState } from "react";
import type { OmpStatus } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { showView, useOmpStatus } from "../../store/index.ts";
import { Button } from "../settings/controls.tsx";
import "../settings/settings.css";
import "./omp-setup.css";

/** 检测通常很快，超过这个时间才显示"正在查找"，免得一闪而过。 */
const FINDING_DELAY_MS = 300;

function useDelayedFlag(on: boolean, delayMs: number): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!on) {
      setFlag(false);
      return;
    }
    const timer = setTimeout(() => setFlag(true), delayMs);
    return () => clearTimeout(timer);
  }, [on, delayMs]);
  return flag;
}

function useBytes(): (bytes: number) => string {
  const locale = useLocale();
  return (bytes) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

function ProgressBar({ received, total }: { received: number; total: number | null }) {
  const fraction = total ? Math.min(1, received / total) : 0;
  return (
    <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="setup-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

export function OmpSetupView() {
  const t = useT();
  const titleId = useId();
  const bytes = useBytes();
  const status = useOmpStatus();
  // "打开设置"之后隐藏准备页，直到状态再变化。
  const [dismissed, setDismissed] = useState<OmpStatus | null>(null);
  const showFinding = useDelayedFlag(status?.state === "discovering", FINDING_DELAY_MS);

  if (status === null || status.state === "ready" || dismissed === status) return null;
  if (status.state === "discovering" && !showFinding) return null;

  const title = (text: string) => (
    <h2 id={titleId} className="setup-title">
      {text}
    </h2>
  );
  const answer = (job: Promise<void>) => void job.catch((error: unknown) => reportError(t, error));

  let body;
  switch (status.state) {
    case "discovering":
      body = <p className="setup-text">{t("omp.finding")}</p>;
      break;
    case "ask_takeover":
      body = (
        <>
          {title(status.launchable ? t("omp.takeover.exeTitle") : t("omp.takeover.title"))}
          {status.version && <p className="setup-text">{t("omp.found", { version: status.version, source: t("omp.source.user") })}</p>}
          <p className="setup-text">{status.launchable ? t("omp.takeover.exeBody") : t("omp.takeover.body")}</p>
          <p className="setup-path st-mono">{t("omp.takeover.where", { path: status.path })}</p>
          <div className="setup-actions">
            <Button variant="primary" large autoFocus onClick={() => answer(window.studio.answerTakeover(true))} testId="takeover-yes">{t("omp.takeover.yes")}</Button>
            <Button large onClick={() => answer(window.studio.answerTakeover(false))} testId="takeover-no">
              {status.launchable ? t("omp.takeover.keep") : t("omp.takeover.no")}
            </Button>
          </div>
        </>
      );
      break;
    case "missing":
      body = (
        <>
          {title(status.version ? t("omp.missing.titleVersion", { version: status.version }) : t("omp.missing.title"))}
          <p className="setup-text">
            {status.sizeBytes !== null ? t("omp.missing.body", { source: status.source, size: bytes(status.sizeBytes) }) : t("omp.missing.bodyNoSize", { source: status.source })}
          </p>
          <div className="setup-actions">
            <Button variant="primary" large autoFocus onClick={() => answer(window.studio.installOmp())} testId="install-omp">
              {t("omp.install")}
            </Button>
            <Button large onClick={() => answer(window.studio.retryOmpSetup())} testId="recheck-omp">
              {t("omp.recheck")}
            </Button>
          </div>
        </>
      );
      break;
    case "installing": {
      const verifying = status.totalBytes !== null && status.receivedBytes >= status.totalBytes;
      body = (
        <>
          {title(status.version ? t("omp.downloading", { version: status.version }) : t("omp.downloading.latest"))}
          <p className="setup-text">{t("omp.install.note")}</p>
          <ProgressBar received={status.receivedBytes} total={status.totalBytes} />
          <p className="setup-meta" aria-live="off">
            {verifying ? t("omp.verifying") : status.totalBytes !== null ? t("omp.progress", { done: bytes(status.receivedBytes), total: bytes(status.totalBytes) }) : null}
          </p>
          {!verifying && (
            <div className="setup-actions">
              <Button large onClick={() => answer(window.studio.cancelOmpInstall())} testId="install-cancel">
                {t("omp.cancelDownload")}
              </Button>
            </div>
          )}
        </>
      );
      break;
    }
    case "unusable":
      body = (
        <>
          {title(t("omp.unusable.title"))}
          <p className="setup-text">{t("omp.takeover.declined")}</p>
          <p className="setup-path st-mono">{t("omp.takeover.where", { path: status.path })}</p>
          <div className="setup-actions">
            <Button variant="primary" large autoFocus onClick={() => answer(window.studio.retryOmpSetup())}>{t("omp.reconsider")}</Button>
          </div>
        </>
      );
      break;
    case "error":
      body = (
        <>
          {title(t("omp.error.title"))}
          <p className="setup-text st-error-text">{status.stage === "verify" ? t("omp.verifyFailed") : t(`omp.error.${status.stage}`)}</p>
          {status.stage === "verify" && <p className="setup-text">{t("omp.error.verify")}</p>}
          <details className="setup-details">
            <summary>{t("omp.error.details")}</summary>
            <pre className="st-mono">{status.message}</pre>
          </details>
          <div className="setup-actions">
            <Button variant="primary" large autoFocus onClick={() => answer(window.studio.retryOmpSetup())} testId="omp-retry">{t("omp.retry")}</Button>
            <Button
              large
              onClick={() => {
                setDismissed(status);
                showView("settings");
              }}
            >
              {t("omp.openSettings")}
            </Button>
          </div>
        </>
      );
      break;
  }

  return (
    <div className="setup" data-testid="omp-setup" data-state={status.state}>
      <div className="setup-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {body}
      </div>
    </div>
  );
}
