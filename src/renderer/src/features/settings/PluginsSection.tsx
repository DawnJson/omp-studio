// 设置 → 插件（spec §4.19）：已装插件（启停、功能、设置、升级、卸载）、市场（来源、浏览、安装）、诊断。
// 数据和动作都经 `omp plugin …`（docs/architecture/plugins.md）；改动后提示"在运行中的任务里重新加载"。
import { useEffect, useId, useMemo } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Restart } from "../../icons.tsx";
import { useOmpStatus, useTasks } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead, type Tone } from "../../ui/controls.tsx";
import { describeError } from "../../ui/errors.ts";
import { Select } from "../../ui/Select.tsx";
import { useProjects } from "../sidebar/projects-store.ts";
import { MarketplacesCard } from "./MarketplacesCard.tsx";
import { PageHeadActions } from "./PageHeadActions.tsx";
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
      <PageHeadActions>
        <span id={scopeLabel} className="pl-scope-label">
          {t("plugins.scope")}
        </span>
        <Select
          size="sm"
          width={168}
          value={state.projectId ?? "user"}
          options={scopeOptions}
          labelledBy={scopeLabel}
          onChange={(next) => setPluginProject(next === "user" ? null : (next as ProjectId))}
          testId="plugins-scope"
        />
      </PageHeadActions>
      <p className="pl-note">{t("plugins.intro")}</p>

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

      <section data-testid="plugins-installed">
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
        {snapshot.data === null && snapshot.busy && <p className="pl-muted">{t("plugins.loading")}</p>}
        {snapshot.data !== null && installedCount === 0 && (
          <p className="pl-muted" data-testid="plugins-empty">
            {t("plugins.installed.empty")}
          </p>
        )}
        <div className="ui-rows">
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
      </section>

      <MarketplacesCard snapshot={snapshot.data} working={state.working} projectId={state.projectId} />

      <section data-testid="plugins-doctor">
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
          <div className="ui-rows">
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
