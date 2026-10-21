// 插件详情：npm / link 插件的"功能"开关和"设置"编辑；市场插件没有这两项（omp 的 features / config 子命令对它们报 not found）。
import { useEffect, useId, useState } from "react";
import type {
  MarketplacePlugin,
  NpmPlugin,
  PluginFeatureInfo,
  PluginSettingSchema,
} from "../../../../shared/omp-output/plugins.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Select, Switch } from "./controls.tsx";
import { loadPluginConfig, runAction, usePluginsState } from "./plugins-store.ts";

function FeatureRow({ plugin, feature, busy }: { plugin: NpmPlugin; feature: PluginFeatureInfo; busy: boolean }) {
  const t = useT();
  const labelId = useId();
  const on = plugin.enabledFeatures === null ? feature.default : plugin.enabledFeatures.includes(feature.name);
  return (
    <div className="pl-detail-row">
      <div className="pl-row-text">
        <span id={labelId} className="pl-name">
          {feature.name}
          {feature.default && <span className="pl-badge">{t("plugins.features.default")}</span>}
        </span>
        {feature.description !== null && <span className="pl-muted">{feature.description}</span>}
      </div>
      <Switch
        checked={on}
        disabled={busy}
        labelledBy={labelId}
        onChange={(next) =>
          void runAction(
            t,
            { kind: "feature", id: plugin.name, feature: feature.name, on: next },
            `feature:${feature.name}`,
          )
        }
        testId={`plugin-feature-${plugin.name}-${feature.name}`}
      />
    </div>
  );
}

function shown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function SettingRow({
  plugin,
  settingKey,
  schema,
  value,
  busy,
}: {
  plugin: string;
  settingKey: string;
  schema: PluginSettingSchema;
  value: unknown;
  busy: boolean;
}) {
  const t = useT();
  const labelId = useId();
  const isSet = value !== undefined;
  const current = isSet ? value : schema.default;
  const [draft, setDraft] = useState(shown(current ?? ""));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(shown(current ?? "")), [current]);
  const save = (text: string) => {
    // omp 的参数解析会把以 `-` 开头的值当成选项，所以不能传；先在这里说清楚。
    if (text.startsWith("-")) return setInvalid(true);
    setInvalid(false);
    void runAction(t, { kind: "configSet", id: plugin, key: settingKey, value: text }, `config:${settingKey}`);
  };

  let control;
  if (schema.type === "boolean") {
    control = (
      <Switch checked={current === true} disabled={busy} labelledBy={labelId} onChange={(next) => save(String(next))} />
    );
  } else if (schema.enum !== undefined && schema.enum.length > 0) {
    const options = schema.enum.map((item) => ({ value: shown(item), label: shown(item) }));
    control = (
      <Select value={shown(current ?? "")} options={options} labelledBy={labelId} disabled={busy} onChange={save} />
    );
  } else {
    control = (
      <>
        <input
          className="st-input"
          type={schema.type === "number" ? "number" : "text"}
          value={draft}
          disabled={busy}
          aria-labelledby={labelId}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && draft !== "" && save(draft)}
          data-testid={`plugin-setting-${plugin}-${settingKey}`}
        />
        <Button disabled={busy || draft === "" || draft === shown(current ?? "")} onClick={() => save(draft)}>
          {t("plugins.settings.save")}
        </Button>
      </>
    );
  }

  return (
    <div className="pl-detail-row">
      <div className="pl-row-text">
        <span id={labelId} className="pl-name">
          {settingKey}
        </span>
        <span className="pl-muted">
          {schema.description ?? ""}
          {schema.default !== undefined && ` ${t("plugins.settings.default", { value: shown(schema.default) })}`}
        </span>
        {invalid && (
          <span className="pl-error" role="alert">
            {t("plugins.settings.dash")}
          </span>
        )}
      </div>
      <div className="pl-actions">
        {control}
        {isSet && (
          <Button
            variant="text"
            disabled={busy}
            onClick={() =>
              void runAction(t, { kind: "configDelete", id: plugin, key: settingKey }, `config:${settingKey}`)
            }
          >
            {t("plugins.settings.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}

function NpmDetails({ plugin, busy }: { plugin: NpmPlugin; busy: boolean }) {
  const t = useT();
  const config = usePluginsState().configs[plugin.name];
  const keys = Object.keys(plugin.settings);
  useEffect(() => {
    if (keys.length > 0) void loadPluginConfig(plugin.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.name]);
  return (
    <>
      <h4 className="pl-subtitle">{t("plugins.features")}</h4>
      {plugin.features.length === 0 && <div className="pl-muted">{t("plugins.features.none")}</div>}
      {plugin.features.map((feature) => (
        <FeatureRow key={feature.name} plugin={plugin} feature={feature} busy={busy} />
      ))}
      <h4 className="pl-subtitle">{t("plugins.settings")}</h4>
      {keys.length === 0 && <div className="pl-muted">{t("plugins.settings.none")}</div>}
      {config?.error != null && (
        <div className="pl-error" role="alert">
          {t("plugins.failed", { message: describeError(t, config.error) })}
        </div>
      )}
      {config?.data != null &&
        Object.entries(config.data.schema).map(([key, schema]) => (
          <SettingRow
            key={key}
            plugin={plugin.name}
            settingKey={key}
            schema={schema}
            value={config.data?.settings[key]}
            busy={busy}
          />
        ))}
    </>
  );
}

export function PluginDetails({ plugin, busy }: { plugin: NpmPlugin | MarketplacePlugin; busy: boolean }) {
  const t = useT();
  return (
    <div className="pl-details" data-testid={`plugin-details-${plugin.kind === "npm" ? plugin.name : plugin.id}`}>
      {plugin.kind === "npm" ? (
        <NpmDetails plugin={plugin} busy={busy} />
      ) : (
        <div className="pl-muted">{t("plugins.settings.marketplaceOnly")}</div>
      )}
    </div>
  );
}
