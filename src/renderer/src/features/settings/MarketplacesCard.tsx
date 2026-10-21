// "市场"：已添加的来源（更新目录、移除）、添加表单、逐个市场浏览可装插件并安装（安装前确认：会运行第三方代码）。
import { useId, useState } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import type { DiscoverEntry, PluginScope, PluginsSnapshot } from "../../../../shared/omp-output/plugins.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Segmented } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { loadDiscover, runAction, usePluginsState } from "./plugins-store.ts";

interface Pending {
  marketplace: string;
  entry: DiscoverEntry;
}

function Browse({
  marketplace,
  installed,
  working,
  onInstall,
}: {
  marketplace: string;
  installed: ReadonlySet<string>;
  working: string | null;
  onInstall(pending: Pending): void;
}) {
  const t = useT();
  const slot = usePluginsState().discover[marketplace];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const entries = (slot?.data ?? []).filter(
    (entry) => needle === "" || `${entry.name} ${entry.description}`.toLowerCase().includes(needle),
  );
  return (
    <div className="pl-browse" data-testid={`marketplace-browse-${marketplace}`}>
      {slot?.busy === true && <div className="pl-muted">{t("plugins.loading")}</div>}
      {slot?.error != null && (
        <div className="pl-error" role="alert">
          {t("plugins.failed", { message: describeError(t, slot.error) })}
        </div>
      )}
      {slot?.data != null && slot.data.length === 0 && (
        <div className="pl-muted">{t("plugins.marketplaces.nothing")}</div>
      )}
      {slot?.data != null && slot.data.length > 0 && (
        <input
          className="st-input"
          type="search"
          value={query}
          placeholder={t("plugins.marketplaces.search")}
          aria-label={t("plugins.marketplaces.search")}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {slot?.data != null && slot.data.length > 0 && entries.length === 0 && (
        <div className="pl-muted">{t("plugins.marketplaces.noMatch")}</div>
      )}
      {entries.map((entry) => {
        const id = `${entry.name}@${marketplace}`;
        const has = installed.has(id);
        return (
          <div key={entry.name} className="pl-detail-row" data-testid={`discover-${id}`}>
            <div className="pl-row-text">
              <span className="pl-name">
                {entry.name}
                {entry.version !== null && <span className="pl-badge">{entry.version}</span>}
              </span>
              <span className="pl-muted pl-desc">{entry.description}</span>
            </div>
            {has ? (
              <span className="pl-muted">{t("plugins.installedBadge")}</span>
            ) : (
              <Button
                disabled={working !== null}
                loading={working === `install:${id}`}
                onClick={() => onInstall({ marketplace, entry })}
                testId={`discover-install-${id}`}
              >
                {t("plugins.install")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MarketplacesCard({
  snapshot,
  working,
  projectId,
}: {
  snapshot: PluginsSnapshot | null;
  working: string | null;
  /** 页面正在看的项目；非空时可以选择装到项目范围。 */
  projectId: ProjectId | null;
}) {
  const t = useT();
  const scopeLabel = useId();
  const [source, setSource] = useState("");
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [installScope, setInstallScope] = useState<PluginScope>("user");
  const busy = working !== null;
  // "已安装"按要装进的范围判断：用户范围装过的，在项目范围里仍然可以装。
  const target = projectId === null ? "user" : installScope;
  const installed = new Set(
    snapshot?.marketplace
      .filter((plugin) => plugin.installs.some((install) => install.scope === target))
      .map((plugin) => plugin.id) ?? [],
  );

  const add = async () => {
    const text = source.trim();
    if (text === "") return;
    if (await runAction(t, { kind: "marketplaceAdd", source: text }, "marketplace:add")) setSource("");
  };
  const toggleBrowse = (name: string) => {
    if (browsing === name) return setBrowsing(null);
    setBrowsing(name);
    void loadDiscover(name);
  };

  return (
    <section className="pl-section" data-testid="plugins-marketplaces">
      <div className="pl-head">
        <h3 className="settings-group-title">{t("plugins.marketplaces")}</h3>
      </div>
      {projectId !== null && (
        <div className="pl-scope" role="group" aria-labelledby={scopeLabel}>
          <span id={scopeLabel} className="pl-muted">
            {t("plugins.install.scope")}
          </span>
          <Segmented
            value={installScope}
            options={[
              { value: "user", label: t("plugins.scope.user") },
              { value: "project", label: t("plugins.scope.project") },
            ]}
            labelledBy={scopeLabel}
            onChange={(next) => setInstallScope(next === "project" ? "project" : "user")}
            testId="plugins-install-scope"
          />
        </div>
      )}
      {snapshot !== null && snapshot.marketplaces.length === 0 && (
        <div className="pl-note">{t("plugins.marketplaces.empty")}</div>
      )}
      {snapshot?.marketplaces.map((marketplace) => (
        <div key={marketplace.name} className="plug-row" data-testid={`marketplace-${marketplace.name}`}>
          <div className="pl-row-main">
            <div className="pl-row-text">
              <span className="pl-name">{marketplace.name}</span>
              <span className="pl-muted pl-source" title={marketplace.source}>
                {marketplace.source}
              </span>
            </div>
            <div className="pl-actions">
              <Button
                onClick={() => toggleBrowse(marketplace.name)}
                testId={`marketplace-browse-btn-${marketplace.name}`}
              >
                {browsing === marketplace.name
                  ? t("plugins.marketplaces.browse.hide")
                  : t("plugins.marketplaces.browse")}
              </Button>
              <Button
                disabled={busy}
                loading={working === `marketplace:update:${marketplace.name}`}
                onClick={() =>
                  void runAction(
                    t,
                    { kind: "marketplaceUpdate", name: marketplace.name },
                    `marketplace:update:${marketplace.name}`,
                  )
                }
              >
                {t("plugins.marketplaces.update")}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void runAction(
                    t,
                    { kind: "marketplaceRemove", name: marketplace.name },
                    `marketplace:remove:${marketplace.name}`,
                  )
                }
                testId={`marketplace-remove-${marketplace.name}`}
              >
                {t("plugins.marketplaces.remove")}
              </Button>
            </div>
          </div>
          {browsing === marketplace.name && (
            <Browse marketplace={marketplace.name} installed={installed} working={working} onInstall={setPending} />
          )}
        </div>
      ))}
      <form
        className="pl-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          className="st-input"
          value={source}
          placeholder={t("plugins.marketplaces.add.placeholder")}
          aria-label={t("plugins.marketplaces.add.label")}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setSource(event.target.value)}
          data-testid="marketplace-add-input"
        />
        <Button
          variant="primary"
          disabled={busy || source.trim() === ""}
          loading={working === "marketplace:add"}
          onClick={() => void add()}
          testId="marketplace-add"
        >
          {t("plugins.marketplaces.add")}
        </Button>
      </form>
      <div className="pl-muted">{t("plugins.marketplaces.remove.hint")}</div>
      {pending !== null && (
        <ConfirmDialog
          title={t("plugins.install.title", { name: pending.entry.name })}
          body={
            t("plugins.install.body", { name: pending.entry.name, marketplace: pending.marketplace }) +
            (projectId !== null && installScope === "project" ? ` ${t("plugins.install.projectNote")}` : "")
          }
          confirmLabel={t("plugins.install.confirm")}
          cancelLabel={t("plugins.cancel")}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const id = `${pending.entry.name}@${pending.marketplace}`;
            setPending(null);
            void runAction(
              t,
              { kind: "install", id, ...(projectId === null ? {} : { scope: installScope }) },
              `install:${id}`,
            );
          }}
        />
      )}
    </section>
  );
}
