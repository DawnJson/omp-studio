// 设置 → 插件（spec §4.19）：已装插件（启停、功能、设置、升级、卸载）、市场（来源、浏览、安装）、诊断。
// 数据和动作都经 `omp plugin …`（docs/architecture/plugins.md）；改动后提示"在运行中的任务里重新加载"。
import { useEffect, useId, useMemo } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus, useTasks } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { useProjects } from "../sidebar/projects-store.ts";
import { Button, Select } from "./controls.tsx";
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

export function PluginsSection() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const tasks = useTasks();
  const state = usePluginsState();
  const { snapshot } = state;
  const busy = state.working !== null;

  useEffect(() => {
    if (ready) void loadPlugins();
  }, [ready]);

  // 选中的项目被移除了：回到用户范围，不假装还看着它。
  const projects = useProjects();
  const projectKnown = state.projectId === null || projects.some((project) => project.id === state.projectId);
  useEffect(() => {
    if (!projectKnown) setPluginProject(null);
  }, [projectKnown]);
  const scopeLabel = useId();
  const scopeOptions = useMemo(
    () => [
      { value: "user", label: t("plugins.scope.user") },
      ...projects.map((project) => ({ value: project.id as string, label: project.name })),
    ],
    [projects, t],
  );

  const installedCount = (snapshot.data?.npm.length ?? 0) + (snapshot.data?.marketplace.length ?? 0);
  const hasMarketplacePlugins = (snapshot.data?.marketplace.length ?? 0) > 0;

  return (
    <>
      <p className="pl-note">{t("plugins.intro")}</p>
      <div className="pl-scope">
        <span id={scopeLabel} className="pl-muted">
          {t("plugins.scope")}
        </span>
        <Select
          value={state.projectId ?? "user"}
          options={scopeOptions}
          labelledBy={scopeLabel}
          onChange={(next) => setPluginProject(next === "user" ? null : (next as ProjectId))}
          testId="plugins-scope"
        />
      </div>

      {state.reloadPending && (
        <div className="pl-reload" role="status" data-testid="plugins-reload">
          <span>{t("plugins.reload.title")}</span>
          <span className="pl-actions">
            <Button variant="text" onClick={dismissReload}>
              {t("plugins.reload.dismiss")}
            </Button>
            <Button
              variant="primary"
              loading={state.reloading}
              onClick={() => void reloadRunningTasks(t, tasks)}
              testId="plugins-reload-action"
            >
              {t("plugins.reload.action")}
            </Button>
          </span>
        </div>
      )}

      <section className="pl-section" data-testid="plugins-installed">
        <div className="pl-head">
          <h3 className="settings-group-title">{t("plugins.installed")}</h3>
          <span className="pl-actions">
            {hasMarketplacePlugins && (
              <Button
                disabled={busy}
                loading={state.working === "upgrade:all"}
                onClick={() => void runAction(t, { kind: "upgrade", id: null }, "upgrade:all")}
                testId="plugins-upgrade-all"
              >
                {t("plugins.upgrade.all")}
              </Button>
            )}
            <Button loading={snapshot.busy} onClick={() => void loadPlugins()}>
              {t("plugins.refresh")}
            </Button>
          </span>
        </div>
        {snapshot.error !== null && (
          <div className="pl-error" role="alert" data-testid="plugins-error">
            {t("plugins.failed", { message: describeError(t, snapshot.error) })}
          </div>
        )}
        {snapshot.data === null && snapshot.busy && <div className="pl-note">{t("plugins.loading")}</div>}
        {snapshot.data !== null && installedCount === 0 && (
          <div className="pl-note" data-testid="plugins-empty">
            {t("plugins.installed.empty")}
          </div>
        )}
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
      </section>

      <MarketplacesCard snapshot={snapshot.data} working={state.working} projectId={state.projectId} />

      <section className="pl-section" data-testid="plugins-doctor">
        <div className="pl-head">
          <h3 className="settings-group-title">{t("plugins.doctor")}</h3>
          <span className="pl-actions">
            <Button
              disabled={busy}
              loading={state.working === "doctor"}
              onClick={() => void runAction(t, { kind: "doctor", fix: false }, "doctor")}
              testId="plugins-doctor-run"
            >
              {t("plugins.doctor.run")}
            </Button>
            <Button
              disabled={busy}
              loading={state.working === "doctor:fix"}
              onClick={() => void runAction(t, { kind: "doctor", fix: true }, "doctor:fix")}
            >
              {t("plugins.doctor.fix")}
            </Button>
          </span>
        </div>
        {state.doctor.data?.map((check) => (
          <div key={check.name} className="pl-check" data-status={check.status}>
            <span className="pl-check-status">{t(STATUS_KEYS[check.status])}</span>
            <span className="pl-check-name">{check.name}</span>
            <span className="pl-muted">{check.message}</span>
          </div>
        ))}
      </section>
    </>
  );
}
