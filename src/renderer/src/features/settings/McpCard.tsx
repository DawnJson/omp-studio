// 设置 → 集成 → MCP 服务器（spec §4.19）：`/mcp list|add|remove|enable|disable|test` 的界面。
// 数据来自 omp 的 command_output 原文（解析器 src/shared/omp-output/mcp.ts，解析不了的行原样显示）；用户范围在服务进程里跑，
// 项目范围在项目目录里的短命 rpc-ui 里跑（列表合并了用户和项目两层，每行标出范围）。
// 做不了的：`reauth` / `unauth` / `reconnect` 在 rpc-ui 里只回"only available in the TUI client"（实测 18.12.5），所以给出终端命令。
import { useEffect, useId, useState } from "react";
import { isManageableMcpName, type McpServerRow, type McpTestResult } from "../../../../shared/omp-output/mcp.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { Button, Card, SettingRow, Switch } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { mcpResource, runMcpTest, runMcpWrite } from "./integrations-data.ts";
import { setCardScope, useCardScope } from "./integrations-store.ts";
import { McpForm } from "./McpForm.tsx";
import { ScopePicker } from "./ScopePicker.tsx";
import "./integrations.css";

type TestState = "running" | McpTestResult;

function McpRow({
  row,
  busy,
  test,
  onTest,
  onToggle,
  onRemove,
}: {
  row: McpServerRow;
  busy: boolean;
  test: TestState | undefined;
  onTest(): void;
  onToggle(next: boolean): void;
  onRemove(): void;
}) {
  const t = useT();
  const id = useId();
  const manageable = isManageableMcpName(row.name);
  const removable = manageable && (row.scope === "user" || row.scope === "project");
  return (
    <div className="st-block" data-testid={`mcp-row-${row.name}`}>
      <div className="st-provider-head">
        <div className="ig-name">
          <div className="ig-title st-ellipsis" id={id} title={row.name}>
            {row.name}
          </div>
          <div className="st-muted st-mono st-ellipsis" title={row.target}>
            {row.target}
          </div>
        </div>
        <div className="ig-meta">
          {row.transport}
          {row.scope !== "" &&
            ` · ${row.scope === "user" ? t("integrations.scope.user") : row.scope === "project" ? t("integrations.scope.project") : row.scope}`}
        </div>
        <div className="st-provider-actions">
          <Switch
            checked={row.enabled}
            disabled={busy || !manageable}
            labelledBy={id}
            onChange={onToggle}
            testId={`mcp-enabled-${row.name}`}
          />
          <Button
            disabled={busy || !manageable}
            loading={test === "running"}
            onClick={onTest}
            testId={`mcp-test-${row.name}`}
          >
            {t("integrations.mcp.test")}
          </Button>
          <Button variant="text" disabled={busy || !removable} onClick={onRemove} testId={`mcp-remove-${row.name}`}>
            {t("integrations.remove")}
          </Button>
        </div>
      </div>
      {!manageable && <div className="st-muted ig-note">{t("integrations.mcp.unmanageable")}</div>}
      {test !== undefined && test !== "running" && (
        <div
          className={test.connected ? "st-muted ig-note" : "st-error-text ig-note ig-raw"}
          role={test.connected ? "status" : "alert"}
          data-testid={`mcp-test-result-${row.name}`}
        >
          {test.connected
            ? t("integrations.mcp.connected", { count: test.toolCount }) +
              (test.tools.length > 0 ? `：${test.tools.join(", ")}` : "")
            : test.message}
        </div>
      )}
    </div>
  );
}

export function McpCard() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const scope = useCardScope("mcp");
  const load = mcpResource.useLoad(scope);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<McpServerRow | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void mcpResource.load(scope);
  }, [ready, scope]);

  const data = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  const write = async (job: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await job();
      if (outcome.ok) pushToast({ message: outcome.message });
      else setFailure(outcome.message);
    } catch (error) {
      setFailure(errorDetail(error));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (name: string) => {
    setTests((current) => ({ ...current, [name]: "running" }));
    try {
      const result = await runMcpTest(name, scope);
      setTests((current) => ({ ...current, [name]: result }));
    } catch (error) {
      setTests((current) => ({ ...current, [name]: { connected: false, message: errorDetail(error) } }));
    }
  };

  return (
    <>
      <h3 className="settings-group-title">{t("integrations.mcp.title")}</h3>
      <Card testId="mcp-card">
        <SettingRow title={t("integrations.field.scope")} desc={t("integrations.mcp.scope.desc")}>
          {(labelId) => (
            <ScopePicker
              value={scope}
              includeUser
              labelledBy={labelId}
              onChange={(next) => {
                setAdding(false);
                setFailure(null);
                setCardScope("mcp", next);
              }}
              testId="mcp-scope-picker"
            />
          )}
        </SettingRow>
        {load.kind === "error" && (
          <div className="st-block st-error-text ig-raw" role="alert" data-testid="mcp-load-failed">
            {t("integrations.loadFailed", { message: errorDetail(load.error) })}
          </div>
        )}
        {!ready && <div className="st-block st-muted">{t("settings.cfg.notReady")}</div>}
        {ready && data === null && load.kind !== "error" && (
          <div className="st-block st-muted">{t("integrations.loading")}</div>
        )}
        {data?.servers.length === 0 && data.unparsed.length === 0 && !adding && (
          <div className="st-block st-muted" data-testid="mcp-empty">
            {t("integrations.mcp.empty")}
          </div>
        )}
        {data?.servers.map((row) => (
          <McpRow
            key={`${row.scope}:${row.name}`}
            row={row}
            busy={busy}
            test={tests[row.name]}
            onTest={() => void runTest(row.name)}
            onToggle={(next) =>
              void write(() => runMcpWrite({ kind: "mcp", op: next ? "enable" : "disable", name: row.name }, scope))
            }
            onRemove={() => setRemoving(row)}
          />
        ))}
        {data !== null && data.unparsed.length > 0 && (
          <pre className="st-block ig-pre" data-testid="mcp-unparsed">
            {data.unparsed.join("\n")}
          </pre>
        )}
        {failure !== null && (
          <div className="st-block st-error-text ig-raw" role="alert" data-testid="mcp-failure">
            {failure}
          </div>
        )}
        {adding && (
          <div className="st-block">
            <McpForm
              scopeKey={scope}
              onDone={(message) => {
                setAdding(false);
                if (message !== null) pushToast({ message });
              }}
            />
          </div>
        )}
        <div className="st-block ig-footer">
          <Button
            variant="primary"
            disabled={!ready || adding || busy}
            onClick={() => setAdding(true)}
            testId="mcp-add"
          >
            {t("integrations.mcp.add")}
          </Button>
          <Button variant="text" disabled={!ready} onClick={() => void mcpResource.load(scope)} testId="mcp-refresh">
            {t("integrations.refresh")}
          </Button>
        </div>
        <div className="st-block st-muted">{t("integrations.mcp.note")}</div>
      </Card>
      {removing !== null && (
        <ConfirmDialog
          title={t("integrations.mcp.remove.title", { name: removing.name })}
          body={t("integrations.mcp.remove.body", {
            scope: removing.scope === "project" ? t("integrations.scope.project") : t("integrations.scope.user"),
          })}
          confirmLabel={t("integrations.remove")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const row = removing;
            setRemoving(null);
            const target = row.scope;
            if (target === "user" || target === "project")
              void write(() => runMcpWrite({ kind: "mcp", op: "remove", name: row.name, scope: target }, scope));
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
