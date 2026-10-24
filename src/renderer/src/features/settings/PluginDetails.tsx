// 插件详情：npm / link 插件的"功能"开关和"设置"编辑；市场插件没有这两项（omp 的 features / config 子命令对它们报 not found），不显示详情。
import { useEffect, useState } from "react";
import type { NpmPlugin, PluginFeatureInfo, PluginSettingSchema } from "../../../../shared/omp-output/plugins.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, Row, SectionHead, Switch, TextField } from "../../ui/controls.tsx";
import { describeError } from "../../ui/errors.ts";
import { Select } from "../../ui/Select.tsx";
import { loadPluginConfig, runAction, usePluginsState } from "./plugins-store.ts";

function FeatureRow({ plugin, feature, busy }: { plugin: NpmPlugin; feature: PluginFeatureInfo; busy: boolean }) {
  const t = useT();
  const on = plugin.enabledFeatures === null ? feature.default : plugin.enabledFeatures.includes(feature.name);
  return (
    <Row
      label={
        <>
          {feature.name}
          {feature.default && <Badge>{t("plugins.features.default")}</Badge>}
        </>
      }
      info={feature.description ?? undefined}
    >
      {(labelId) => (
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
      )}
    </Row>
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

  const info = [schema.description ?? "", invalid ? t("plugins.settings.dash") : ""].filter(Boolean).join(" ");
  const defaultText =
    schema.default !== undefined ? t("plugins.settings.default", { value: shown(schema.default) }) : "";

  return (
    <Row
      label={settingKey}
      info={[info, defaultText].filter(Boolean).join(" ") || undefined}
      modified={isSet}
      reset={{
        tip: [t("plugins.settings.reset"), defaultText].filter(Boolean).join(" · "),
        onReset: () => void runAction(t, { kind: "configDelete", id: plugin, key: settingKey }, `config:${settingKey}`),
      }}
    >
      {(labelId) => {
        if (schema.type === "boolean")
          return (
            <Switch
              checked={current === true}
              disabled={busy}
              labelledBy={labelId}
              onChange={(next) => save(String(next))}
            />
          );
        if (schema.enum !== undefined && schema.enum.length > 0)
          return (
            <Select
              size="sm"
              value={shown(current ?? "")}
              options={schema.enum.map((item) => ({ value: shown(item), label: shown(item) }))}
              labelledBy={labelId}
              disabled={busy}
              onChange={save}
            />
          );
        return (
          <>
            <TextField
              size="sm"
              width={200}
              type={schema.type === "number" ? "number" : "text"}
              value={draft}
              disabled={busy}
              invalid={invalid}
              aria-labelledby={labelId}
              onChange={setDraft}
              onKeyDown={(event) => event.key === "Enter" && draft !== "" && save(draft)}
              testId={`plugin-setting-${plugin}-${settingKey}`}
            />
            <Button
              size="sm"
              disabled={busy || draft === "" || draft === shown(current ?? "")}
              onClick={() => save(draft)}
            >
              {t("plugins.settings.save")}
            </Button>
          </>
        );
      }}
    </Row>
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
      {plugin.features.length > 0 && <SectionHead title={t("plugins.features")} />}
      <div className="ui-rows">
        {plugin.features.map((feature) => (
          <FeatureRow key={feature.name} plugin={plugin} feature={feature} busy={busy} />
        ))}
      </div>
      {keys.length > 0 && <SectionHead title={t("plugins.settings")} />}
      {config?.error != null && (
        <p className="pl-error" role="alert">
          {t("plugins.failed", { message: describeError(t, config.error) })}
        </p>
      )}
      <div className="ui-rows">
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
      </div>
    </>
  );
}

export function PluginDetails({ plugin, busy }: { plugin: NpmPlugin; busy: boolean }) {
  return (
    <div className="pl-details" data-testid={`plugin-details-${plugin.name}`}>
      <NpmDetails plugin={plugin} busy={busy} />
    </div>
  );
}
