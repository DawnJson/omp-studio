// 设置 → 集成与插件的插件部分（spec §4.19）：已装插件（启停、功能、设置、升级、卸载）、市场（来源、浏览、安装）、诊断。
// 数据和动作都经 `omp plugin …`（docs/architecture/plugins.md）；改动后提示"在运行中的任务里重新加载"。
import { useEffect } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Restart } from "../../icons.tsx";
import { useOmpStatus, useTasks } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead, type Tone } from "../../ui/controls.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { describeError } from "../../ui/errors.ts";
import { MarketplacesCard } from "./MarketplacesCard.tsx";
import { PluginRow } from "./PluginRow.tsx";
import {
  dismissReload,
  loadPlugins,
  reloadRunningTasks,
  runAction,
  setPluginProject,
  usePluginsState,
} from "./plugins-store.ts";
import "./plugins.css";

const STATUS_KEYS = {
  ok: "plugins.doctor.ok",
  warning: "plugins.doctor.warning",
  error: "plugins.doctor.error",
} as const;

const STATUS_TONES: Record<keyof typeof STATUS_KEYS, Tone> = { ok: "success", warning: "warning", error: "error" };

/** 范围由集成页页头的"范围"下拉决定（和 MCP、SSH、Skills 同一个），这里不另放一个。 */
export function PluginsSection({ projectId }: { projectId: ProjectId | null }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const tasks = useTasks();
  const state = usePluginsState();
  const { snapshot } = state;
  const busy = state.working !== null;

  useEffect(() => {
    setPluginProject(projectId);
    if (ready) void loadPlugins();
  }, [ready, projectId]);

  const installedCount = (snapshot.data?.npm.length ?? 0) + (snapshot.data?.marketplace.length ?? 0);
  const hasMarketplacePlugins = (snapshot.data?.marketplace.length ?? 0) > 0;

  return (
    <>
      {state.reloadPending && (
        <Notice
          testId="plugins-reload"
          action={
            <span className="pl-actions">
              <Button size="sm" variant="quiet" onClick={dismissReload}>
                {t("plugins.reload.dismiss")}
              </Button>
              <Button
                size="sm"
                loading={state.reloading}
                onClick={() => void reloadRunningTasks(t, tasks)}
                testId="plugins-reload-action"
              >
                {t("plugins.reload.action")}
              </Button>
            </span>
          }
        >
          {t("plugins.reload.title")}
        </Notice>
      )}

      <section className="st-section" data-testid="plugins-installed">
        <SectionHead
          title={t("plugins.installed")}
          count={snapshot.data === null ? undefined : installedCount}
          actions={
            <>
              {hasMarketplacePlugins && (
                <Button
                  size="sm"
                  disabled={busy}
                  loading={state.working === "upgrade:all"}
                  onClick={() => void runAction(t, { kind: "upgrade", id: null }, "upgrade:all")}
                  testId="plugins-upgrade-all"
                >
                  {t("plugins.upgrade.all")}
                </Button>
              )}
              <IconButton
                label={t("plugins.refresh")}
                disabled={snapshot.busy}
                onClick={() => void loadPlugins()}
                testId="plugins-refresh"
              >
                <Restart />
              </IconButton>
            </>
          }
        />
        {snapshot.error !== null && (
          <Notice tone="error" testId="plugins-error">
            {t("plugins.failed", { message: describeError(t, snapshot.error) })}
          </Notice>
        )}
        {snapshot.data === null && snapshot.busy && (
          <Skeleton variant="row" label={t("plugins.loading")} testId="plugins-skeleton" />
        )}
        {snapshot.data !== null && installedCount === 0 && (
          <p className="pl-muted" data-testid="plugins-empty">
            {t("plugins.installed.empty")}
          </p>
        )}
        {installedCount > 0 && (
          <div className="ui-data-in">
            {snapshot.data?.npm.map((plugin) => (
              <PluginRow key={`npm:${plugin.name}`} plugin={plugin} working={state.working} />
            ))}
            {snapshot.data?.marketplace.flatMap((plugin) =>
              plugin.installs.map((install) => (
                <PluginRow
                  key={`mk:${plugin.id}:${install.scope}`}
                  plugin={plugin}
                  install={install}
                  working={state.working}
                />
              )),
            )}
          </div>
        )}
      </section>

      <MarketplacesCard snapshot={snapshot.data} working={state.working} projectId={state.projectId} />

      <section className="st-section" data-testid="plugins-doctor">
        <SectionHead
          title={t("plugins.doctor")}
          actions={
            <>
              <Button
                size="sm"
                disabled={busy}
                loading={state.working === "doctor"}
                onClick={() => void runAction(t, { kind: "doctor", fix: false }, "doctor")}
                testId="plugins-doctor-run"
              >
                {t("plugins.doctor.run")}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                loading={state.working === "doctor:fix"}
                onClick={() => void runAction(t, { kind: "doctor", fix: true }, "doctor:fix")}
              >
                {t("plugins.doctor.fix")}
              </Button>
            </>
          }
        />
        {state.doctor.data != null && state.doctor.data.length > 0 && (
          <div className="ui-cards">
            {state.doctor.data.map((check) => (
              <ListRow
                key={check.name}
                icon={check.name.slice(0, 2)}
                title={check.name}
                badges={<Badge tone={STATUS_TONES[check.status]}>{t(STATUS_KEYS[check.status])}</Badge>}
                meta={check.message}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
