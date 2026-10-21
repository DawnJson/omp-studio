// 一个已装插件的一行：名称、版本、启用开关、详情（npm / link 插件的功能和设置）、升级、卸载（带确认）。
// 市场插件按"安装"一行一个：同一个插件在用户和项目范围都装了就是两行，每行的动作带自己的 --scope。
import { useId, useState } from "react";
import type { MarketplaceInstall, MarketplacePlugin, NpmPlugin } from "../../../../shared/omp-output/plugins.ts";
import { ChevronDown, ChevronRight } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { Button, Switch } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { PluginDetails } from "./PluginDetails.tsx";
import { runAction } from "./plugins-store.ts";

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
  const [confirming, setConfirming] = useState(false);
  const nameId = useId();
  const busy = working !== null;
  const id = plugin.kind === "npm" ? plugin.name : plugin.id;
  const scope =
    install?.scope === "project" ? ("project" as const) : install === undefined ? undefined : ("user" as const);
  const rowKey = scope === "project" ? `${id}:project` : id;
  const enabled = plugin.kind === "npm" ? plugin.enabled : (install?.enabled ?? true);
  const version = plugin.kind === "npm" ? plugin.version : (install?.version ?? "");
  const description = plugin.kind === "npm" ? plugin.description : null;
  const scoped = scope === undefined ? {} : { scope };

  return (
    <div className="plug-row" data-testid={`plugin-row-${rowKey}`}>
      <div className="pl-row-main">
        <button
          type="button"
          className="pl-expand"
          aria-expanded={open}
          aria-label={open ? t("plugins.details.hide") : t("plugins.details")}
          onClick={() => setOpen(!open)}
          data-testid={`plugin-expand-${rowKey}`}
        >
          {open ? <ChevronDown size={14} className="icon" /> : <ChevronRight size={14} className="icon" />}
        </button>
        <div className="pl-row-text">
          <span id={nameId} className="pl-name">
            {id}
            {scope === "project" && <span className="pl-badge">{t("plugins.scope.project")}</span>}
          </span>
          <span className="pl-muted">
            {version !== "" && t("plugins.version", { version })}
            {description !== null && ` · ${description}`}
          </span>
        </div>
        <div className="pl-actions">
          {/* 链接的本地插件没有可升级的来源（omp 会拒绝），所以只有市场插件显示"升级"。 */}
          {plugin.kind === "marketplace" && (
            <Button
              disabled={busy}
              loading={working === `upgrade:${rowKey}`}
              onClick={() => void runAction(t, { kind: "upgrade", id, ...scoped }, `upgrade:${rowKey}`)}
              testId={`plugin-upgrade-${rowKey}`}
            >
              {t("plugins.upgrade")}
            </Button>
          )}
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
            testId={`plugin-uninstall-${rowKey}`}
          >
            {t("plugins.uninstall")}
          </Button>
          <Switch
            checked={enabled}
            disabled={busy}
            labelledBy={nameId}
            onChange={(next) =>
              void runAction(t, { kind: next ? "enable" : "disable", id, ...scoped }, `toggle:${rowKey}`)
            }
            testId={`plugin-enabled-${rowKey}`}
          />
        </div>
      </div>
      {open && <PluginDetails plugin={plugin} busy={busy} />}
      {confirming && (
        <ConfirmDialog
          title={t("plugins.uninstall.title", { name: id })}
          body={t("plugins.uninstall.body")}
          confirmLabel={t("plugins.uninstall.confirm")}
          cancelLabel={t("plugins.cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void runAction(t, { kind: "uninstall", id, ...scoped }, `uninstall:${rowKey}`);
          }}
        />
      )}
    </div>
  );
}
