// 分享会话链接：`omp share <会话文件> [--gist]`。**会把加密快照上传到外部服务器**（share.serverUrl，或 secret gist），
// 所以先确认：说明上传到哪里、脱敏开没开，用户点"上传并生成链接"才真的发出（AGENTS.md「先停下来问」：发到外部服务）。
// 成功后显示链接（可复制、可在浏览器打开）；omp 的输出里认不出链接时原样显示 omp 的输出，不猜。
import { useEffect, useState } from "react";
import type { ShareResult, ShareSettings, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Checkbox, Notice } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Reserve } from "../../ui/Reserve.tsx";
import { explainError, reportError } from "../../ui/errors.ts";
import { copyText } from "./session-info-actions.ts";
import { closeShareDialog } from "./session-info-store.ts";
import "./session-info.css";

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
  if (phase.kind === "done") {
    const { result } = phase;
    return (
      <>
        {result.url !== null ? (
          <>
            {result.gistUrl !== null && <span className="si-note">{t("sessionInfo.share.url")}</span>}
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
  return (
    <>
      {/* 勾上 / 取消"上传到 gist"会换一段警告文字：两段叠在一格里占位，外框大小不变 */}
      <Reserve
        ghosts={[
          <Notice key="other" tone="warning">
            {t(gist ? "sessionInfo.share.warn" : "sessionInfo.share.warnGist", { server: settings.serverUrl })}
          </Notice>,
        ]}
      >
        <Notice tone="warning" testId="share-warning">
          {t(gist ? "sessionInfo.share.warnGist" : "sessionInfo.share.warn", { server: settings.serverUrl })}
        </Notice>
      </Reserve>
      {!settings.redactSecrets && (
        <p className="si-note" data-testid="share-redact" data-redact={settings.redactSecrets}>
          {t("sessionInfo.share.redactOff")}
        </p>
      )}
      <Checkbox checked={gist} onChange={onGist} disabled={phase.kind === "uploading"} testId="share-gist">
        {t("sessionInfo.share.gist")}
      </Checkbox>
      {phase.kind === "error" && (
        <Notice tone="error" testId="share-error">
          {t("sessionInfo.share.failed", { message: explainError(t, phase.error) })}
        </Notice>
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
    <Dialog
      title={t("sessionInfo.share.title")}
      testId="share-dialog"
      open={open}
      onClose={closeShareDialog}
      footer={
        done !== null ? (
          done.url !== null ? (
            // 拿到链接后这一步要做的是复制：复制是主按钮并拿焦点（Enter 即复制），关闭交给 × / Esc（2026-10-29）。
            <>
              <Button
                onClick={() =>
                  void window.studio.openExternal(done.url ?? "").catch((error: unknown) => reportError(t, error))
                }
                testId="share-open"
              >
                {t("sessionInfo.share.open")}
              </Button>
              <Button variant="primary" autoFocus onClick={() => copyText(t, done.url ?? "")} testId="share-copy">
                {t("sessionInfo.share.copy")}
              </Button>
            </>
          ) : (
            <Button variant="primary" autoFocus onClick={closeShareDialog}>
              {t("common.close")}
            </Button>
          )
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
        <Notice tone="error">
          {t("sessionInfo.share.settingsFailed", { message: explainError(t, settingsError) })}
        </Notice>
      )}
      {settings === null && settingsError === null && <p className="si-note">{t("sessionInfo.loading")}</p>}
      {settings !== null && <Body settings={settings} phase={phase} gist={gist} onGist={setGist} />}
    </Dialog>
  );
}
