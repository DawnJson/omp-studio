// 设置 → 工具与权限 → 可用工具（spec §4.19）：`/tools` 的列表。每个工具一行：名称 + 状态；omp 里有对应的 `<工具>.enabled` 设置项的，
// 行尾放一个开关（就是那一项设置本身，写 `omp config set`，和设置页下面那一行是同一个值）。
// 列表是服务进程（用户范围）看到的全局结果：项目里的插件和 MCP 提供的工具不在里面；`-` 是可用但当前没启用，`~` 是 xd 设备。
// 关掉一个工具后它会从 omp 的列表里消失（实测 18.12.5：`bash.enabled=false` 后 `/tools` 里没有 bash），所以这里不自动重读，
// 行保留着，开关还能再打开；点"刷新"才读 omp 现在的列表。
import { useEffect, useId, useMemo } from "react";
import { toolConfigKey, type ToolEntry } from "../../../../shared/omp-output/tools.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { Button, Card, Switch } from "./controls.tsx";
import { ensureOmpConfigLoaded, saveOmpConfig, useConfigLoad, useOmpConfigValue, useRowState } from "./config-store.ts";
import { toolsResource } from "./integrations-data.ts";
import "./integrations.css";

function ToolRow({ tool, configKey }: { tool: ToolEntry; configKey: string | null }) {
  const t = useT();
  const id = useId();
  const value = useOmpConfigValue(configKey ?? "");
  const row = useRowState(configKey ?? "");
  const state =
    tool.state === "enabled"
      ? t("integrations.tools.enabled")
      : tool.state === "inactive"
        ? t("integrations.tools.inactive")
        : t("integrations.tools.device");
  return (
    <div className="ig-tool" data-testid={`tool-${tool.name}`} data-state={tool.state}>
      <div className="ig-tool-text">
        <span className="ig-tool-name st-mono st-ellipsis" id={id} title={tool.name}>
          {tool.name}
        </span>
        <span className="st-muted">{state}</span>
      </div>
      {configKey !== null && typeof value === "boolean" && (
        <Switch
          checked={value}
          disabled={row.phase === "saving"}
          labelledBy={id}
          onChange={(next) => void saveOmpConfig(configKey, next)}
          testId={`tool-switch-${tool.name}`}
        />
      )}
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

  return (
    <>
      <h3 className="settings-group-title">{t("integrations.tools.title")}</h3>
      <Card testId="tools-card">
        {load.kind === "error" && (
          <div className="st-block st-error-text ig-raw" role="alert" data-testid="tools-load-failed">
            {t("integrations.loadFailed", { message: errorDetail(load.error) })}
          </div>
        )}
        {!ready && <div className="st-block st-muted">{t("settings.cfg.notReady")}</div>}
        {ready && data === null && load.kind !== "error" && (
          <div className="st-block st-muted">{t("integrations.loading")}</div>
        )}
        {data !== null && (
          <div className="st-block ig-tools" data-testid="tools-list">
            {data.tools.map((tool) => (
              <ToolRow
                key={tool.name}
                tool={tool}
                configKey={tool.state === "device" ? null : toolConfigKey(tool.name, keys)}
              />
            ))}
          </div>
        )}
        {data !== null && data.unparsed.length > 0 && (
          <pre className="st-block ig-pre" data-testid="tools-unparsed">
            {data.unparsed.join("\n")}
          </pre>
        )}
        <div className="st-block ig-footer">
          <Button
            variant="text"
            disabled={!ready}
            onClick={() => void toolsResource.load("global")}
            testId="tools-refresh"
          >
            {t("integrations.refresh")}
          </Button>
        </div>
        <div className="st-block st-muted">{t("integrations.tools.note")}</div>
      </Card>
    </>
  );
}
