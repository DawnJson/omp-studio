// 设置 → 关于 → omp：路径、版本、来源，以及对应来源的更新方式（spec §4.19、§4.21）。
//   自管：检查更新（omp-studio 自己请求构建服务）、加入用户 PATH；
//   用户自装（拒绝了接管）：升级 = 对它执行 omp update；
//   别人管理（如 Tern）：只提示去管理者那里更新，没有按钮。
import { describeError } from "../../ui/errors.ts";
import { useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { OmpSource, OmpStatus, OmpUpgradeResult } from "../../../../shared/ipc.ts";
import { MIN_OMP_VERSION } from "../../../../shared/omp-version.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, Button, Notice, Row } from "../../ui/controls.tsx";

type Ready = Extract<OmpStatus, { state: "ready" }>;

function sourceLabel(source: OmpSource, t: TFunction): string {
  switch (source.kind) {
    case "managed_by_other":
      return t("omp.source.other", { name: source.managerName });
    case "studio_managed":
      return t("omp.source.studio");
    case "user_installed":
      return t("omp.source.user");
  }
}

/** 输出的最后 3 行（spec §4.21）。 */
function tail(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(-3)
    .join("\n");
}

export function OmpSection() {
  const t = useT();
  const status = useOmpStatus();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState<"check" | "upgrade" | "path" | null>(null);
  const [upgrade, setUpgrade] = useState<OmpUpgradeResult | null>(null);

  if (status?.state !== "ready") return <p className="st-muted">{t("omp.finding")}</p>;
  const ready: Ready = status;

  const run = async (kind: "check" | "upgrade" | "path", job: () => Promise<void>) => {
    setBusy(kind);
    setNote(null);
    try {
      await job();
    } catch (error) {
      const message = describeError(t, error);
      setNote({
        text:
          kind === "check"
            ? t("omp.checkFailed", { message })
            : kind === "path"
              ? t("omp.addPath.failed", { message })
              : message,
        error: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const checkUpdate = () =>
    run("check", async () => {
      const { installedVersion, availableVersion } = await window.studio.checkOmpUpdate();
      // 有新版本时不写提示：那一行（omp-available）常驻显示，随语言切换。
      setNote(
        availableVersion
          ? null
          : {
              text: installedVersion ? t("omp.updatedTo", { version: installedVersion }) : t("omp.upToDate"),
              error: false,
            },
      );
    });
  const upgradeOmp = () =>
    run("upgrade", async () => {
      setUpgrade(await window.studio.upgradePathOmp());
    });

  const source = ready.source;
  return (
    <>
      {ready.belowMinimum && (
        <Notice tone="error">{t("omp.outdated", { current: ready.version, min: MIN_OMP_VERSION })}</Notice>
      )}
      <div className="ui-rows st-rows" data-testid="omp-info">
        <Row
          label={t("omp.version")}
          info={
            source.kind === "studio_managed"
              ? t("omp.autoUpdate.note")
              : source.kind === "managed_by_other"
                ? `${t("omp.updateByManager", { name: source.managerName })} ${t("omp.autoUpdate.noteOther")}`
                : t("omp.autoUpdate.noteOther")
          }
        >
          {() => (
            <>
              <span className="st-mono" data-testid="omp-version">
                {ready.version}
              </span>
              <Badge testId="omp-source">{sourceLabel(source, t)}</Badge>
              {ready.availableVersion && (
                <span data-testid="omp-available">{t("omp.newVersion", { version: ready.availableVersion })}</span>
              )}
              <Button
                size="sm"
                loading={busy === "check"}
                disabled={busy !== null}
                onClick={() => void checkUpdate()}
                testId="omp-check-update"
              >
                {t("omp.checkUpdate")}
              </Button>
              {source.kind === "user_installed" && (
                <Button
                  size="sm"
                  loading={busy === "upgrade"}
                  disabled={busy !== null}
                  onClick={() => void upgradeOmp()}
                  testId="omp-upgrade"
                >
                  {busy === "upgrade" ? t("omp.upgrading") : t("omp.upgrade")}
                </Button>
              )}
            </>
          )}
        </Row>
        <Row label={t("omp.path")}>
          {() => (
            <span className="st-mono st-path" title={ready.path} data-testid="omp-path">
              {ready.path}
            </span>
          )}
        </Row>
        {source.kind === "studio_managed" && !source.onUserPath && (
          <Row label={t("omp.addPath")} info={t("omp.addPath.note")}>
            {() => (
              <Button
                size="sm"
                loading={busy === "path"}
                disabled={busy !== null}
                onClick={() => void run("path", () => window.studio.addManagedOmpToPath())}
                testId="omp-add-path"
              >
                {t("omp.addPath.yes")}
              </Button>
            )}
          </Row>
        )}
      </div>
      {(note !== null || upgrade !== null) && (
        <div className="st-result" role="status">
          {note && <div className={note.error ? "st-error-text" : undefined}>{note.text}</div>}
          {upgrade && (
            <>
              <div className={upgrade.exitCode === 0 ? undefined : "st-error-text"}>
                {upgrade.exitCode === 0
                  ? t("omp.upgradeDone")
                  : t("omp.upgradeFailed", { code: upgrade.exitCode ?? "?" })}
              </div>
              <pre className="st-mono st-output">{tail(upgrade.output)}</pre>
            </>
          )}
        </div>
      )}
    </>
  );
}
