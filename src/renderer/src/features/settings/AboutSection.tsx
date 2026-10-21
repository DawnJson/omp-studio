// 设置 → 关于：当前版本、omp-studio 自身的更新（检查、下载进度、重启并安装）、问题排查。
// 更新源和只有安装版才生效的规则见 src/main/update/instance.ts。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { useAppInfo, useUpdateState } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Card, SettingRow } from "./controls.tsx";
import { TroubleshootCard } from "./TroubleshootCard.tsx";
import { updateStatusText } from "./update-status.ts";

export function AboutSection() {
  const t = useT();
  const info = useAppInfo();
  const state = useUpdateState();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setNote(null);
    try {
      await window.studio.checkForUpdate();
    } catch (error) {
      setNote(describeError(t, error));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    setNote(null);
    try {
      await window.studio.installUpdate();
    } catch (error) {
      setNote(t("settings.about.installFailed", { message: describeError(t, error) }));
      setBusy(false);
    }
  };

  if (info === null || state === null) return <div className="st-muted">{t("settings.about.idle")}</div>;

  const canCheck =
    state.phase !== "downloaded" &&
    state.phase !== "downloading" &&
    state.phase !== "checking" &&
    state.phase !== "disabled";
  const downloading = state.phase === "downloading";

  return (
    <>
      <Card testId="about-info">
        <SettingRow title={t("settings.about.version")}>
          {() => (
            <span className="st-mono" data-testid="app-version">
              {info.version}
            </span>
          )}
        </SettingRow>
        <SettingRow title={t("settings.about.update")}>
          {() => (
            <div className="st-update">
              <span data-testid="update-status">{updateStatusText(state, t)}</span>
              {state.phase === "downloaded" ? (
                <Button variant="primary" loading={busy} onClick={() => void install()} testId="update-install">
                  {t("settings.about.install")}
                </Button>
              ) : (
                <Button
                  loading={busy || state.phase === "checking"}
                  disabled={!canCheck}
                  onClick={() => void check()}
                  testId="update-check"
                >
                  {t("settings.about.check")}
                </Button>
              )}
            </div>
          )}
        </SettingRow>
      </Card>
      {downloading && (
        <div
          className="st-block"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.percent}
          data-testid="update-progress"
        >
          <div className="st-update-bar">
            <div className="st-update-bar-fill" style={{ transform: `scaleX(${state.percent / 100})` }} />
          </div>
        </div>
      )}
      {note !== null && (
        <div className="st-block st-result" role="status">
          <span className="st-error-text">{note}</span>
        </div>
      )}
      <TroubleshootCard />
    </>
  );
}
