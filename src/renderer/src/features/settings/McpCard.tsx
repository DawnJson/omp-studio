// 设置 → 集成 → MCP 服务器（spec §4.19）：`/mcp list|add|remove|enable|disable|test` 的界面。
// 数据来自 omp 的 command_output 原文（解析器 src/shared/omp-output/mcp.ts，解析不了的行原样显示）；用户范围在服务进程里跑，
// 项目范围在项目目录里的短命 rpc-ui 里跑（列表合并了用户和项目两层，每行标出范围）。范围由集成页页头的下拉选（IntegrationsSection）。
// 做不了的：`reauth` / `unauth` / `reconnect` 在 rpc-ui 里只回"only available in the TUI client"（实测 18.12.5），所以给出终端命令。
import { useEffect, useState } from "react";
import { isManageableMcpName, type McpServerRow, type McpTestResult } from "../../../../shared/omp-output/mcp.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus, Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { mcpResource, runMcpTest, runMcpWrite } from "./integrations-data.ts";
import type { ScopeKey } from "./integrations-store.ts";
import { McpForm } from "./McpForm.tsx";
import { RowMenu } from "./RowMenu.tsx";
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
  const manageable = isManageableMcpName(row.name);
  const removable = manageable && (row.scope === "user" || row.scope === "project");
  const scopeText =
    row.scope === "user"
      ? t("integrations.scope.user")
      : row.scope === "project"
        ? t("integrations.scope.project")
        : row.scope;
  return (
    <div data-testid={`mcp-row-${row.name}`}>
      <ListRow
        icon={row.name.slice(0, 2)}
        title={row.name}
        badges={scopeText !== "" ? <Badge>{scopeText}</Badge> : undefined}
        meta={[row.transport, row.target].filter((part) => part !== "").join(" · ")}
        actions={
          <>
            <Button
              size="sm"
              disabled={busy || !manageable}
              loading={test === "running"}
              onClick={onTest}
              testId={`mcp-test-${row.name}`}
            >
              {t("integrations.mcp.test")}
            </Button>
            <Switch
              checked={row.enabled}
              disabled={busy || !manageable}
              label={row.name}
              onChange={onToggle}
              testId={`mcp-enabled-${row.name}`}
            />
            <RowMenu
              label={t("integrations.more")}
              disabled={busy || !removable}
              testId={`mcp-more-${row.name}`}
              items={[
                {
                  id: "remove",
                  label: t("integrations.remove"),
                  tone: "danger",
                  testId: `mcp-remove-${row.name}`,
                  onSelect: onRemove,
                },
              ]}
            />
          </>
        }
      />
      {!manageable && <p className="ig-note">{t("integrations.mcp.unmanageable")}</p>}
      {test !== undefined && test !== "running" && (
        <p
          className={test.connected ? "ig-note" : "ig-note ig-raw ig-error"}
          role={test.connected ? "status" : "alert"}
          data-testid={`mcp-test-result-${row.name}`}
        >
          {test.connected
            ? t("integrations.mcp.connected", { count: test.toolCount }) +
              (test.tools.length > 0 ? `：${test.tools.join(", ")}` : "")
            : test.message}
        </p>
      )}
    </div>
  );
}

export function McpCard({ scope }: { scope: ScopeKey }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = mcpResource.useLoad(scope);
  const { slot: adding, open: openAdding, closed: addingClosed, reset: resetAdding } = useDialogSlot();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<McpServerRow | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void mcpResource.load(scope);
  }, [ready, scope]);
  // 换范围：关掉添加对话框、清掉上一个范围的失败提示。
  useEffect(() => {
    resetAdding();
    setFailure(null);
  }, [scope, resetAdding]);

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
    <div data-testid="mcp-card">
      <SectionHead
        title={t("integrations.mcp.title")}
        count={data?.servers.length}
        actions={
          <>
            <IconButton
              label={t("integrations.refresh")}
              disabled={!ready}
              onClick={() => void mcpResource.load(scope)}
              testId="mcp-refresh"
            >
              <Restart />
            </IconButton>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={!ready || busy}
              onClick={() => openAdding(true)}
              testId="mcp-add"
            >
              {t("integrations.mcp.add")}
            </Button>
          </>
        }
      />
      {load.kind === "error" && (
        <Notice tone="error" testId="mcp-load-failed">
          <span className="ig-raw">{t("integrations.loadFailed", { message: errorDetail(load.error) })}</span>
        </Notice>
      )}
      {!ready && <p className="ig-note">{t("settings.cfg.notReady")}</p>}
      {ready && data === null && load.kind !== "error" && <p className="ig-note">{t("integrations.loading")}</p>}
      {data?.servers.length === 0 && data.unparsed.length === 0 && (
        <p className="ig-note" data-testid="mcp-empty">
          {t("integrations.mcp.empty")}
        </p>
      )}
      {data !== null && data.servers.length > 0 && (
        <div className="ui-rows">
          {data.servers.map((row) => (
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
        </div>
      )}
      {data !== null && data.unparsed.length > 0 && (
        <pre className="ig-pre" data-testid="mcp-unparsed">
          {data.unparsed.join("\n")}
        </pre>
      )}
      {failure !== null && (
        <Notice tone="error" testId="mcp-failure">
          <span className="ig-raw">{failure}</span>
        </Notice>
      )}
      <p className="ig-note">{t("integrations.mcp.note")}</p>
      {adding !== null && (
        <McpForm
          key={adding.key}
          scopeKey={scope}
          onDone={(message) => {
            addingClosed(adding.key);
            if (message !== null) pushToast({ message });
          }}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          danger
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
    </div>
  );
}
