// 一个已装插件的一行：名称、版本、详情（npm / link 插件的功能和设置）、升级、启用开关、卸载（带确认）。
// 市场插件按"安装"一行一个：同一个插件在用户和项目范围都装了就是两行，每行的动作带自己的 --scope。
import { useId, useState } from "react";
import type { MarketplaceInstall, MarketplacePlugin, NpmPlugin } from "../../../../shared/omp-output/plugins.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, Disclosure, ListRow, Switch } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { monogram } from "./monogram.ts";
import { PluginDetails } from "./PluginDetails.tsx";
import { runAction } from "./plugins-store.ts";
import { RowMenu } from "./RowMenu.tsx";

export function PluginRow({
  plugin,
  install,
  working,
}: {
  plugin: NpmPlugin | MarketplacePlugin;
  /** 市场插件的某一个安装（范围）。 */
  install?: MarketplaceInstall;
  working: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // 确认框用 slot：上一个还在放退出动画时再点卸载也能立刻开新的。
  const { slot: confirming, open: openConfirming, closed: confirmingClosed } = useDialogSlot();
  const detailsId = useId();
  const busy = working !== null;
  const id = plugin.kind === "npm" ? plugin.name : plugin.id;
  const scope =
    install?.scope === "project" ? ("project" as const) : install === undefined ? undefined : ("user" as const);
  const rowKey = scope === "project" ? `${id}:project` : id;
  const enabled = plugin.kind === "npm" ? plugin.enabled : (install?.enabled ?? true);
  const version = plugin.kind === "npm" ? plugin.version : (install?.version ?? "");
  const description = plugin.kind === "npm" ? plugin.description : null;
  const scoped = scope === undefined ? {} : { scope };
  // 市场安装的插件没有功能和设置项；npm 插件两样都没有时也没有可展开的内容：都不显示详情。
  const npmDetails =
    plugin.kind === "npm" && (plugin.features.length > 0 || Object.keys(plugin.settings).length > 0) ? plugin : null;
  const meta = [version !== "" ? t("plugins.version", { version }) : "", description ?? ""]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <div data-testid={`plugin-row-${rowKey}`}>
      <ListRow
        icon={monogram(id)}
        title={id}
        badges={scope === "project" ? <Badge>{t("plugins.scope.project")}</Badge> : undefined}
        meta={meta === "" ? undefined : meta}
        actions={
          <>
            {npmDetails !== null && (
              <Disclosure
                expanded={open}
                controls={detailsId}
                onToggle={() => setOpen(!open)}
                testId={`plugin-expand-${rowKey}`}
              >
                {open ? t("plugins.details.hide") : t("plugins.details")}
              </Disclosure>
            )}
            {/* 链接的本地插件没有可升级的来源（omp 会拒绝），所以只有市场插件显示"升级"。 */}
            {plugin.kind === "marketplace" && (
              <Button
                size="sm"
                disabled={busy}
                loading={working === `upgrade:${rowKey}`}
                onClick={() => void runAction(t, { kind: "upgrade", id, ...scoped }, `upgrade:${rowKey}`)}
                testId={`plugin-upgrade-${rowKey}`}
              >
                {t("plugins.upgrade")}
              </Button>
            )}
            <Switch
              checked={enabled}
              disabled={busy}
              label={id}
              onChange={(next) =>
                void runAction(t, { kind: next ? "enable" : "disable", id, ...scoped }, `toggle:${rowKey}`)
              }
              testId={`plugin-enabled-${rowKey}`}
            />
            <RowMenu
              label={t("plugins.more")}
              disabled={busy}
              testId={`plugin-more-${rowKey}`}
              items={[
                {
                  id: "uninstall",
                  label: t("plugins.uninstall"),
                  tone: "danger",
                  testId: `plugin-uninstall-${rowKey}`,
                  onSelect: () => openConfirming(true),
                },
              ]}
            />
          </>
        }
      />
      {npmDetails !== null && (
        <Reveal open={open} id={detailsId}>
          <PluginDetails plugin={npmDetails} busy={busy} />
        </Reveal>
      )}
      {confirming !== null && (
        <ConfirmDialog
          key={confirming.key}
          danger
          title={t("plugins.uninstall.title", { name: id })}
          body={t("plugins.uninstall.body")}
          confirmLabel={t("plugins.uninstall.confirm")}
          cancelLabel={t("common.cancel")}
          onCancel={() => confirmingClosed(confirming.key)}
          onConfirm={() => {
            confirmingClosed(confirming.key);
            void runAction(t, { kind: "uninstall", id, ...scoped }, `uninstall:${rowKey}`);
          }}
        />
      )}
    </div>
  );
}
