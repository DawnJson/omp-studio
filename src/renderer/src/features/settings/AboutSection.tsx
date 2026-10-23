// 设置 → 关于：版本（omp-studio、omp 各一行：各自的检查更新、下载进度、重启并安装，下面是 omp 的路径；OmpSection），
// 更新日志（omp-studio、omp 各自最新一版），问题排查。两个"检查更新"各管各的。更新源和只有安装版才生效的规则见 src/main/update/instance.ts。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { useAppInfo, useUpdateState } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Row, SectionHead } from "../../ui/controls.tsx";
import { Changelog } from "./Changelog.tsx";
import { OmpSection } from "./OmpSection.tsx";
import { TroubleshootCard } from "./TroubleshootCard.tsx";
import { updateStatusText } from "./update-status.ts";

export function AboutSection() {
  const t = useT();
  return (
    <>
      <SectionHead title={t("settings.about.versions")} />
      <OmpSection studio={<StudioUpdate />} />
      <Changelog />
      <SectionHead title={t("settings.about.troubleshoot")} />
      <TroubleshootCard />
    </>
  );
}

/** omp-studio 的版本那一行（放进 OmpSection 的版本块）。 */
function StudioUpdate() {
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

  if (info === null || state === null)
    return <Row label="omp-studio">{() => <span className="st-muted">{t("settings.about.idle")}</span>}</Row>;

  const canCheck =
    state.phase !== "downloaded" &&
    state.phase !== "downloading" &&
    state.phase !== "checking" &&
    state.phase !== "disabled";
  const downloading = state.phase === "downloading";

  return (
    <Row label="omp-studio" testId="about-info">
      {() => (
        <>
          <span className="st-mono" data-testid="app-version">
            {info.version}
          </span>
          <span className="st-muted" data-testid="update-status">
            {updateStatusText(state, t)}
          </span>
          {state.phase === "downloaded" ? (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void install()} testId="update-install">
              {t("settings.about.install")}
            </Button>
          ) : (
            <Button
              size="sm"
              loading={busy || state.phase === "checking"}
              disabled={!canCheck}
              onClick={() => void check()}
              testId="update-check"
            >
              {t("settings.about.check")}
            </Button>
          )}
          {downloading && (
            <div
              className="st-update-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              data-testid="update-progress"
            >
              <div className="st-update-bar-fill" style={{ transform: `scaleX(${state.percent / 100})` }} />
            </div>
          )}
          {note !== null && (
            <span className="cfg-note cfg-error" role="status">
              {note}
            </span>
          )}
        </>
      )}
    </Row>
  );
}
