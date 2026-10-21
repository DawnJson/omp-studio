// 分享会话链接：`omp share <会话文件> [--gist]`。**会把加密快照上传到外部服务器**（share.serverUrl，或 secret gist），
// 所以先确认：说明上传到哪里、脱敏开没开，用户点"上传并生成链接"才真的发出（AGENTS.md "先停下来问"：对外发送内容）。
// 成功后显示链接（可复制、可在浏览器打开）；omp 的输出里认不出链接时原样显示 omp 的输出，不猜。
import { useEffect, useId, useState } from "react";
import type { ShareResult, ShareSettings, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { Button } from "../settings/controls.tsx";
import { DialogShell } from "./DialogShell.tsx";
import { copyText } from "./session-info-actions.ts";
import { closeShareDialog } from "./session-info-store.ts";

type Phase =
  | { kind: "confirm" }
  | { kind: "uploading" }
  | { kind: "done"; result: ShareResult }
  | { kind: "error"; error: unknown };

function Body({
  settings,
  phase,
  gist,
  onGist,
}: {
  settings: ShareSettings;
  phase: Phase;
  gist: boolean;
  onGist(value: boolean): void;
}) {
  const t = useT();
  const gistId = useId();
  if (phase.kind === "done") {
    const { result } = phase;
    return (
      <>
        <p className="si-note">{t("sessionInfo.share.done")}</p>
        {result.url !== null ? (
          <>
            <span className="si-note">{t("sessionInfo.share.url")}</span>
            <code className="si-url" data-testid="share-url">
              {result.url}
            </code>
            {result.gistUrl !== null && (
              <>
                <span className="si-note">{t("sessionInfo.share.gistUrl")}</span>
                <code className="si-url" data-testid="share-gist-url">
                  {result.gistUrl}
                </code>
              </>
            )}
          </>
        ) : (
          <>
            <span className="si-note">{t("sessionInfo.share.raw")}</span>
            <pre className="si-pre" data-testid="share-raw">
              {result.text}
            </pre>
          </>
        )}
      </>
    );
  }
  const store = gist ? "gist" : "blob";
  return (
    <>
      <p className="si-warn" data-testid="share-warning">
        {t(store === "gist" ? "sessionInfo.share.warnGist" : "sessionInfo.share.warn", { server: settings.serverUrl })}
      </p>
      <p className="si-note" data-testid="share-redact" data-redact={settings.redactSecrets}>
        {t(settings.redactSecrets ? "sessionInfo.share.redactOn" : "sessionInfo.share.redactOff")}
      </p>
      <label className="si-check" htmlFor={gistId}>
        <input
          id={gistId}
          type="checkbox"
          data-testid="share-gist"
          checked={gist}
          disabled={phase.kind === "uploading"}
          onChange={(event) => onGist(event.currentTarget.checked)}
        />
        {t("sessionInfo.share.gist")}
      </label>
      {phase.kind === "error" && (
        <p className="si-error" role="alert" data-testid="share-error">
          {t("sessionInfo.share.failed", { message: describeError(t, phase.error) })}
        </p>
      )}
    </>
  );
}

export function ShareDialog({ taskId, open }: { taskId: TaskId; open: boolean }) {
  const t = useT();
  const [settings, setSettings] = useState<ShareSettings | null>(null);
  const [settingsError, setSettingsError] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const [gist, setGist] = useState(false);

  useEffect(() => {
    let current = true;
    setSettings(null);
    setSettingsError(null);
    setPhase({ kind: "confirm" });
    window.studio.getShareSettings(taskId).then(
      (value) => {
        if (!current) return;
        setSettings(value);
        setGist(value.store === "gist");
      },
      (error: unknown) => current && setSettingsError(error),
    );
    return () => {
      current = false;
    };
  }, [taskId]);

  const upload = () => {
    setPhase({ kind: "uploading" });
    window.studio.shareTask(taskId, gist).then(
      (result) => setPhase({ kind: "done", result }),
      (error: unknown) => setPhase({ kind: "error", error }),
    );
  };

  const done = phase.kind === "done" ? phase.result : null;
  return (
    <DialogShell
      title={t("sessionInfo.share.title")}
      testId="share-dialog"
      open={open}
      onClose={closeShareDialog}
      footer={
        done !== null ? (
          <>
            {done.url !== null && (
              <>
                <Button onClick={() => copyText(t, done.url ?? "")} testId="share-copy">
                  {t("sessionInfo.share.copy")}
                </Button>
                <Button
                  onClick={() =>
                    void window.studio.openExternal(done.url ?? "").catch((error: unknown) => reportError(t, error))
                  }
                  testId="share-open"
                >
                  {t("sessionInfo.share.open")}
                </Button>
              </>
            )}
            <Button variant="primary" onClick={closeShareDialog}>
              {t("common.close")}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={closeShareDialog}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              disabled={settings === null}
              loading={phase.kind === "uploading"}
              onClick={upload}
              testId="share-confirm"
            >
              {phase.kind === "uploading" ? t("sessionInfo.share.uploading") : t("sessionInfo.share.confirm")}
            </Button>
          </>
        )
      }
    >
      {settingsError !== null && (
        <p className="si-error" role="alert">
          {t("sessionInfo.share.settingsFailed", { message: describeError(t, settingsError) })}
        </p>
      )}
      {settings === null && settingsError === null && <p className="si-note">{t("sessionInfo.loading")}</p>}
      {settings !== null && <Body settings={settings} phase={phase} gist={gist} onGist={setGist} />}
    </DialogShell>
  );
}
