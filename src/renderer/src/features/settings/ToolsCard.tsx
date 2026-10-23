// 设置 → 工具与权限 → 可用工具（spec §4.19）：`/tools` 的列表。每格一样：名称 + 状态徽标；omp 里有对应的 `<工具>.enabled` 设置项的，
// 格尾放一个开关（就是那一项设置本身，写 `omp config set`，和设置页上面常用项里的是同一个值），徽标跟着开关走。
// 没有开关的行不是坏了：mcp__* 由 MCP 服务器整体启停、init_experiment 这类由 omp 的模式启用、`~` 的 xd 设备是同一个工具的入口，
// 徽标的 tooltip 写明原因和去哪里改（实测见 docs/architecture/omp-settings.md「/tools」）。
// 列表是服务进程（用户范围）看到的全局结果：项目里的插件和 MCP 提供的工具不在里面。
// 关掉一个工具后它会从 omp 的列表里消失（实测 18.12.5：`bash.enabled=false` 后 `/tools` 里没有 bash），所以这里不自动重读，
// 格子保留着，开关还能再打开；点标题右侧的 ↻ 才读 omp 现在的列表。
import { useEffect, useMemo } from "react";
import { deviceToolNames, toolConfigKey, toolKind, type ToolEntry } from "../../../../shared/omp-output/tools.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, IconButton, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { ensureOmpConfigLoaded, saveOmpConfig, useConfigLoad, useOmpConfigValue, useRowState } from "./config-store.ts";
import { toolsResource } from "./integrations-data.ts";

function ToolCell({ tool, configKey, devices }: { tool: ToolEntry; configKey: string | null; devices: Set<string> }) {
  const t = useT();
  const value = useOmpConfigValue(configKey ?? "");
  const row = useRowState(configKey ?? "");
  const hasSwitch = configKey !== null && typeof value === "boolean";
  const kind = toolKind(tool, devices);
  const testId = `tool-badge-${tool.name}`;
  let badge;
  if (kind === "device") {
    badge = (
      <Badge title={t("integrations.tools.device.tip")} testId={testId}>
        {t("integrations.tools.device")}
      </Badge>
    );
  } else if (hasSwitch ? value : kind === "enabled") {
    badge = (
      <Badge tone="success" dot testId={testId}>
        {t("integrations.tools.enabled")}
      </Badge>
    );
  } else if (hasSwitch) {
    badge = <Badge testId={testId}>{t("settings.tools.off")}</Badge>;
  } else if (kind === "mountedMcp" || kind === "mounted") {
    badge = (
      <Badge
        title={t(kind === "mountedMcp" ? "integrations.tools.mounted.mcpTip" : "integrations.tools.mounted.tip")}
        testId={testId}
      >
        {t("integrations.tools.mounted")}
      </Badge>
    );
  } else {
    badge = (
      <Badge title={t("integrations.tools.inactive.tip")} testId={testId}>
        {t("settings.tools.off")}
      </Badge>
    );
  }
  return (
    <div className="st-tool" data-testid={`tool-${tool.name}`} data-state={tool.state} data-kind={kind}>
      <span className="st-tool-name st-mono" title={tool.name}>
        {tool.name}
      </span>
      {badge}
      <span className="st-tool-slot">
        {hasSwitch && (
          <Switch
            checked={value}
            disabled={row.phase === "saving"}
            label={tool.name}
            onChange={(next) => void saveOmpConfig(configKey, next)}
            testId={`tool-switch-${tool.name}`}
          />
        )}
      </span>
    </div>
  );
}

export function ToolsCard() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = toolsResource.useLoad("global");
  const config = useConfigLoad();

  useEffect(() => {
    if (!ready) return;
    ensureOmpConfigLoaded();
    void toolsResource.load("global");
  }, [ready]);

  const keys = useMemo(
    () => new Set(config.kind === "ready" ? config.snapshot.items.map((item) => item.key) : []),
    [config],
  );
  const data = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;
  const devices = useMemo(() => deviceToolNames(data?.tools ?? []), [data]);

  return (
    <section className="st-section" data-testid="tools-card">
      <SectionHead
        title={t("integrations.tools.title")}
        count={data?.tools.length}
        actions={
          <IconButton
            label={t("integrations.refresh")}
            disabled={!ready}
            onClick={() => void toolsResource.load("global")}
            testId="tools-refresh"
          >
            <Restart />
          </IconButton>
        }
        note={t("integrations.tools.note")}
      />
      {load.kind === "error" && (
        <Notice tone="error" testId="tools-load-failed">
          {t("integrations.loadFailed", { message: errorDetail(load.error) })}
        </Notice>
      )}
      {!ready && <p className="st-muted">{t("settings.cfg.notReady")}</p>}
      {ready && data === null && load.kind !== "error" && <p className="st-muted">{t("integrations.loading")}</p>}
      {data !== null && (
        <div className="st-tools" data-testid="tools-list">
          {data.tools.map((tool) => (
            <ToolCell
              key={tool.name}
              tool={tool}
              devices={devices}
              configKey={tool.state === "device" ? null : toolConfigKey(tool.name, keys)}
            />
          ))}
        </div>
      )}
      {data !== null && data.unparsed.length > 0 && (
        <pre className="st-pre" data-testid="tools-unparsed">
          {data.unparsed.join("\n")}
        </pre>
      )}
    </section>
  );
}
