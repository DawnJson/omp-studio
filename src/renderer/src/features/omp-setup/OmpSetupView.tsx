// omp 准备页（spec §4.22）：盖在应用上的居中卡片，只在需要用户参与或在等待时出现；omp 就绪后自己消失。
// 状态来自 store 的 OmpStatus：检测中、问接管、下载中、出错、脚本启动不了。
// 导出名和 props 是 App.tsx 的约定（始终渲染，由本组件决定要不要显示）。
import { reportError } from "../../ui/errors.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePresence } from "../../ui/presence.ts";
import type { OmpStatus } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { showView, useOmpStatus } from "../../store/index.ts";
import { usePlatform } from "../../app/platform-keys.ts";
import { Button, Disclosure } from "../../ui/controls.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
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
    <div
      className="setup-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div className="setup-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}
/** 出错详情：默认收起，点开看原始报错。 */
function ErrorDetails({ message, label }: { message: string; label: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="setup-details">
      <Disclosure expanded={open} onToggle={() => setOpen(!open)} controls={panelId}>
        {label}
      </Disclosure>
      <Reveal open={open} id={panelId}>
        <pre>{message}</pre>
      </Reveal>
    </div>
  );
}

export function OmpSetupView() {
  const t = useT();
  const titleId = useId();
  const bytes = useBytes();
  const status = useOmpStatus();
  const platform = usePlatform();
  // "打开设置"之后隐藏准备页，直到状态再变化。
  const [dismissed, setDismissed] = useState<OmpStatus | null>(null);
  const showFinding = useDelayedFlag(status?.state === "discovering", FINDING_DELAY_MS);
  // 只有"是否接管"这一态有遮罩。
  useTitleBarDim(status?.state === "ask_takeover" && dismissed !== status);

  const visible =
    status !== null &&
    status.state !== "ready" &&
    dismissed !== status &&
    !(status.state === "discovering" && !showFinding);
  const presence = usePresence(visible, "pop");
  // 隐藏（就绪 / 点了打开设置）后留着最后一帧的内容放完退出动画。
  const lastRef = useRef<{ state: string; body: ReactNode } | null>(null);
  if (!visible) {
    const last = lastRef.current;
    if (!presence.mounted || last === null) return null;
    return (
      <div className="setup" data-testid="omp-setup" data-state={last.state} data-closing="fade">
        <div className="setup-card" role="dialog" aria-modal="true" aria-labelledby={titleId} {...presence.exitProps}>
          {last.body}
        </div>
      </div>
    );
  }

  const title = (text: string) => (
    <h2 id={titleId} className="setup-title">
      {text}
    </h2>
  );
  const answer = (job: Promise<void>) => void job.catch((error: unknown) => reportError(t, error));
  // 只有 Windows 会把 omp-studio 装的 omp 放进用户 PATH；macOS / Linux 不改 PATH，文案不能说会放进 PATH。
  const studioOnly = platform !== "win32";

  let body;
  switch (status.state) {
    case "discovering":
      body = (
        <p className="setup-finding" role="status">
          {t("omp.finding")}
        </p>
      );
      break;
    case "ask_takeover": {
      const other = status.managerName;
      body = (
        <>
          {title(
            other !== null
              ? t("omp.takeover.otherTitle", { name: other })
              : status.launchable
                ? t("omp.takeover.exeTitle")
                : t("omp.takeover.title"),
          )}
          <p className="setup-text">
            {other !== null
              ? t(studioOnly ? "omp.takeover.otherBodyStudioOnly" : "omp.takeover.otherBody", { name: other })
              : status.launchable
                ? t(studioOnly ? "omp.takeover.exeBodyStudioOnly" : "omp.takeover.exeBody")
                : t(studioOnly ? "omp.takeover.bodyStudioOnly" : "omp.takeover.body")}
          </p>
          <p className="setup-path">
            {status.version
              ? t("omp.takeover.whereVersion", { path: status.path, version: status.version })
              : t("omp.takeover.where", { path: status.path })}
          </p>
          <div className="setup-actions">
            <Button autoFocus onClick={() => answer(window.studio.answerTakeover(false))} testId="takeover-no">
              {other !== null
                ? t("omp.takeover.keepOther", { name: other })
                : status.launchable
                  ? t("omp.takeover.keep")
                  : t("omp.takeover.no")}
            </Button>
            <Button variant="primary" onClick={() => answer(window.studio.answerTakeover(true))} testId="takeover-yes">
              {t("omp.takeover.yes")}
            </Button>
          </div>
        </>
      );
      break;
    }
    case "missing":
      body = (
        <>
          {title(status.version ? t("omp.missing.titleVersion", { version: status.version }) : t("omp.missing.title"))}
          <p className="setup-text">
            {status.sizeBytes !== null
              ? t(studioOnly ? "omp.missing.bodyStudioOnly" : "omp.missing.body", {
                  source: status.source,
                  size: bytes(status.sizeBytes),
                })
              : t(studioOnly ? "omp.missing.bodyNoSizeStudioOnly" : "omp.missing.bodyNoSize", {
                  source: status.source,
                })}
          </p>
          <div className="setup-actions">
            <Button onClick={() => answer(window.studio.retryOmpSetup())} testId="recheck-omp">
              {t("omp.recheck")}
            </Button>
            <Button variant="primary" autoFocus onClick={() => answer(window.studio.installOmp())} testId="install-omp">
              {t("omp.install")}
            </Button>
          </div>
        </>
      );
      break;
    case "installing": {
      const verifying = status.totalBytes !== null && status.receivedBytes >= status.totalBytes;
      // 校验时标题换成"正在校验"，进度行和取消按钮都留着（按钮禁用）：卡片高度不变，居中的卡片不跳。
      body = (
        <>
          {title(
            verifying
              ? t("omp.verifying")
              : status.version
                ? t("omp.downloading", { version: status.version })
                : t("omp.downloading.latest"),
          )}
          <ProgressBar received={status.receivedBytes} total={status.totalBytes} />
          <p className="setup-meta" aria-live="off">
            {status.totalBytes !== null
              ? t("omp.progress", { done: bytes(status.receivedBytes), total: bytes(status.totalBytes) })
              : null}
          </p>
          <div className="setup-actions">
            <Button
              disabled={verifying}
              onClick={() => answer(window.studio.cancelOmpInstall())}
              testId="install-cancel"
            >
              {t("omp.cancelDownload")}
            </Button>
          </div>
        </>
      );
      break;
    }
    case "unusable":
      body = (
        <>
          {title(t("omp.unusable.title"))}
          <p className="setup-text">{t("omp.takeover.declined")}</p>
          <p className="setup-path">{t("omp.takeover.where", { path: status.path })}</p>
          <div className="setup-actions">
            <Button variant="primary" autoFocus onClick={() => answer(window.studio.retryOmpSetup())}>
              {t("omp.reconsider")}
            </Button>
          </div>
        </>
      );
      break;
    case "error":
      body = (
        <>
          {title(t("omp.error.title"))}
          <p className="setup-text setup-error">
            {status.stage === "verify" ? t("omp.verifyFailed") : t(`omp.error.${status.stage}`)}
          </p>
          {status.stage === "verify" && <p className="setup-text">{t("omp.error.verify")}</p>}
          <ErrorDetails message={status.message} label={t("omp.error.details")} />
          <div className="setup-actions">
            <Button
              onClick={() => {
                setDismissed(status);
                showView("settings");
              }}
            >
              {t("omp.openSettings")}
            </Button>
            <Button
              variant="primary"
              autoFocus
              onClick={() => answer(window.studio.retryOmpSetup())}
              testId="omp-retry"
            >
              {t("omp.retry")}
            </Button>
          </div>
        </>
      );
      break;
  }

  lastRef.current = { state: status.state, body };
  return (
    <div
      className="setup"
      data-testid="omp-setup"
      data-state={status.state}
      data-closing={presence.closing ? "fade" : undefined}
    >
      <div className="setup-card" role="dialog" aria-modal="true" aria-labelledby={titleId} {...presence.exitProps}>
        {body}
      </div>
    </div>
  );
}
