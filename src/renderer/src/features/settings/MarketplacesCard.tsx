// "市场"：已添加的来源（浏览、更新目录、移除）、添加对话框、逐个市场浏览可装插件并安装（安装前确认：会运行第三方代码）。
import { useState } from "react";
import type { ProjectId } from "../../../../shared/ipc.ts";
import {
  type DiscoverEntry,
  PRESET_MARKETPLACES,
  type PluginScope,
  type PluginsSnapshot,
} from "../../../../shared/omp-output/plugins.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { Plus, Search } from "../../icons.tsx";
import { Badge, Button, FormField, ListRow, SectionHead, Segmented, TextField } from "../../ui/controls.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { ConfirmDialog, Dialog } from "../../ui/Dialog.tsx";
import { describeError } from "../../ui/errors.ts";
import { useDialogSlot } from "../../ui/presence.ts";
import { loadDiscover, runAction, usePluginsState } from "./plugins-store.ts";
import { RowMenu } from "./RowMenu.tsx";
import "./integrations.css";

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
      {slot?.busy === true && slot.data == null && (
        <Skeleton variant="card" label={t("plugins.loading")} testId="marketplace-skeleton" />
      )}
      {slot?.error != null && (
        <p className="pl-error" role="alert">
          {t("plugins.failed", { message: describeError(t, slot.error) })}
        </p>
      )}
      {slot?.data != null && slot.data.length === 0 && <p className="pl-muted">{t("plugins.marketplaces.nothing")}</p>}
      {slot?.data != null && slot.data.length > 0 && (
        <TextField
          type="search"
          size="sm"
          width="100%"
          leading={<Search size={14} />}
          value={query}
          placeholder={t("plugins.marketplaces.search")}
          aria-label={t("plugins.marketplaces.search")}
          onChange={setQuery}
        />
      )}
      {slot?.data != null && slot.data.length > 0 && entries.length === 0 && (
        <p className="pl-muted">{t("plugins.marketplaces.noMatch")}</p>
      )}
      <div className="ui-cards ui-data-in">
        {entries.map((entry) => {
          const id = `${entry.name}@${marketplace}`;
          const has = installed.has(id);
          return (
            <ListRow
              key={entry.name}
              testId={`discover-${id}`}
              icon={entry.name.slice(0, 2)}
              title={entry.name}
              badges={entry.version !== null ? <Badge>{entry.version}</Badge> : undefined}
              meta={
                // 和 Skills 卡片一样只显示两行，完整描述在悬停提示里。
                entry.description !== "" && (
                  <span className="ig-clamp" title={entry.description}>
                    {entry.description}
                  </span>
                )
              }
              actions={
                has ? (
                  <Badge tone="success">{t("plugins.installedBadge")}</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={working !== null}
                    loading={working === `install:${id}`}
                    onClick={() => onInstall({ marketplace, entry })}
                    testId={`discover-install-${id}`}
                  >
                    {t("plugins.install")}
                  </Button>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function AddMarketplaceDialog({ working, onClose }: { working: string | null; onClose(): void }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState("");
  const busy = working !== null;
  const add = async () => {
    const text = source.trim();
    if (text === "") return;
    if (await runAction(t, { kind: "marketplaceAdd", source: text }, "marketplace:add")) setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={t("plugins.marketplaces.add.title")}
      testId="marketplace-add-dialog"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={busy || source.trim() === ""}
            loading={working === "marketplace:add"}
            onClick={() => void add()}
            testId="marketplace-add"
          >
            {t("plugins.marketplaces.add")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <FormField label={t("plugins.marketplaces.add.label")} help={t("plugins.marketplaces.add.hint")}>
          <TextField
            width="100%"
            mono
            data-autofocus=""
            value={source}
            disabled={busy}
            aria-label={t("plugins.marketplaces.add.label")}
            onChange={setSource}
            testId="marketplace-add-input"
          />
        </FormField>
        <button type="submit" hidden />
      </form>
    </Dialog>
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
  const locale = useLocale();
  const { slot: adding, open: openAdding, closed: addingClosed } = useDialogSlot();
  const [browsing, setBrowsing] = useState<string | null>(null);
  // 确认框用 slot：上一个还在放退出动画时再点安装也能立刻开新的。
  const { slot: pending, open: openPending, closed: pendingClosed } = useDialogSlot<Pending>();
  const [installScope, setInstallScope] = useState<PluginScope>("user");
  const busy = working !== null;
  // "已安装"按要装进的范围判断：用户范围装过的，在项目范围里仍然可以装。
  const target = projectId === null ? "user" : installScope;
  const installed = new Set(
    snapshot?.marketplace
      .filter((plugin) => plugin.installs.some((install) => install.scope === target))
      .map((plugin) => plugin.id) ?? [],
  );

  const toggleBrowse = (name: string) => {
    if (browsing === name) return setBrowsing(null);
    setBrowsing(name);
    void loadDiscover(name);
  };

  // 已添加的判断：omp 的市场名或来源（`marketplace list` 原样回显添加时写的 owner/repo）与预设一致。
  const presets =
    snapshot === null
      ? []
      : PRESET_MARKETPLACES.filter(
          (preset) =>
            !snapshot.marketplaces.some(
              (market) => market.name === preset.name || market.source.toLowerCase() === preset.source,
            ),
        );
  // 加完直接展开"浏览"，用户马上看到可装的插件。
  const addPreset = async (preset: (typeof PRESET_MARKETPLACES)[number]) => {
    if (!(await runAction(t, { kind: "marketplaceAdd", source: preset.source }, `marketplace:add:${preset.source}`)))
      return;
    toggleBrowse(preset.name);
  };

  return (
    <section className="st-section" data-testid="plugins-marketplaces">
      <SectionHead
        title={t("plugins.marketplaces")}
        count={snapshot?.marketplaces.length}
        actions={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={busy}
            onClick={() => openAdding(true)}
            testId="marketplace-add-open"
          >
            {t("plugins.marketplaces.add.open")}
          </Button>
        }
      />
      {projectId !== null && (
        <div className="pl-scope">
          <span className="pl-muted">{t("plugins.install.scope")}</span>
          <Segmented
            size="sm"
            value={installScope}
            options={[
              { value: "user", label: t("plugins.scope.user") },
              { value: "project", label: t("plugins.scope.project") },
            ]}
            label={t("plugins.install.scope")}
            onChange={(next) => setInstallScope(next === "project" ? "project" : "user")}
            testId="plugins-install-scope"
          />
        </div>
      )}
      {(snapshot?.marketplaces.length ?? 0) > 0 && (
        <div>
          {snapshot?.marketplaces.map((marketplace) => (
            <div key={marketplace.name} data-testid={`marketplace-${marketplace.name}`}>
              <ListRow
                icon={marketplace.name.slice(0, 2)}
                title={marketplace.name}
                meta={marketplace.source}
                actions={
                  <>
                    <Button
                      size="sm"
                      onClick={() => toggleBrowse(marketplace.name)}
                      testId={`marketplace-browse-btn-${marketplace.name}`}
                    >
                      {browsing === marketplace.name
                        ? t("plugins.marketplaces.browse.hide")
                        : t("plugins.marketplaces.browse")}
                    </Button>
                    <Button
                      size="sm"
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
                    <RowMenu
                      label={t("plugins.more")}
                      disabled={busy}
                      testId={`marketplace-more-${marketplace.name}`}
                      items={[
                        {
                          id: "remove",
                          label: t("plugins.marketplaces.remove"),
                          note: t("plugins.marketplaces.remove.hint"),
                          tone: "danger",
                          testId: `marketplace-remove-${marketplace.name}`,
                          onSelect: () =>
                            void runAction(
                              t,
                              { kind: "marketplaceRemove", name: marketplace.name },
                              `marketplace:remove:${marketplace.name}`,
                            ),
                        },
                      ]}
                    />
                  </>
                }
              />
              {browsing === marketplace.name && (
                <Browse
                  marketplace={marketplace.name}
                  installed={installed}
                  working={working}
                  onInstall={openPending}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {presets.length > 0 && (
        <div data-testid="marketplace-presets">
          <p className="pl-muted">{t("plugins.marketplaces.presets")}</p>
          <div>
            {presets.map((preset) => (
              <ListRow
                key={preset.source}
                icon={preset.name.slice(0, 2)}
                title={preset.label[locale]}
                meta={preset.source}
                testId={`marketplace-preset-${preset.name}`}
                actions={
                  <Button
                    size="sm"
                    icon={<Plus size={14} />}
                    disabled={busy}
                    loading={working === `marketplace:add:${preset.source}`}
                    onClick={() => void addPreset(preset)}
                    testId={`marketplace-preset-add-${preset.name}`}
                  >
                    {t("plugins.marketplaces.add")}
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}
      {adding !== null && (
        <AddMarketplaceDialog key={adding.key} working={working} onClose={() => addingClosed(adding.key)} />
      )}
      {pending !== null && (
        <ConfirmDialog
          key={pending.key}
          testId="plugin-install-confirm"
          title={t("plugins.install.title", { name: pending.value.entry.name })}
          body={
            t("plugins.install.body", { name: pending.value.entry.name, marketplace: pending.value.marketplace }) +
            (projectId !== null && installScope === "project" ? ` ${t("plugins.install.projectNote")}` : "")
          }
          confirmLabel={t("plugins.install.confirm")}
          cancelLabel={t("common.cancel")}
          onCancel={() => pendingClosed(pending.key)}
          onConfirm={() => {
            const id = `${pending.value.entry.name}@${pending.value.marketplace}`;
            pendingClosed(pending.key);
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
