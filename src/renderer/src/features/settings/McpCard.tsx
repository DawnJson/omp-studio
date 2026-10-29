// 设置 → 集成 → MCP 服务器（spec §4.19）：`/mcp list|add|remove|enable|disable|test` 的界面，加上直接改 omp 的 mcp.json 的编辑（McpForm）。
// 数据来自 omp 的 command_output 原文（解析器 src/shared/omp-output/mcp.ts，解析不了的行原样显示）；用户范围在服务进程里跑，
// 项目范围在项目目录里的短命 rpc-ui 里跑（列表合并了用户和项目两层，每行标出范围）。范围由集成页页头的下拉选（IntegrationsSection）。
// 做不了的：`reauth` / `unauth` / `reconnect` 在 rpc-ui 里只回"only available in the TUI client"（实测 18.12.5），所以给出终端命令。
import { useEffect, useState } from "react";
import { isManageableMcpName, type McpServerRow, type McpTestResult } from "../../../../shared/omp-output/mcp.ts";
import type { McpEditErrorCode, McpServerFile } from "../../../../shared/mcp-edit.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus, Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { mcpResource, runMcpTest, runMcpWrite } from "./integrations-data.ts";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import { McpForm } from "./McpForm.tsx";
import { monogram } from "./monogram.ts";
import { RowMenu } from "./RowMenu.tsx";
import { TitleTip } from "./TitleTip.tsx";
import { useAsyncAction } from "./use-async-action.ts";
import "./integrations.css";

type TestState = "running" | McpTestResult;

function McpRow({
  row,
  busy,
  showScope,
  test,
  onTest,
  onToggle,
  onEdit,
  onRemove,
}: {
  row: McpServerRow;
  busy: boolean;
  /** 只在选了某个项目（两层合并显示）时写每行的范围；用户范围下每行都一样，没有信息。 */
  showScope: boolean;
  test: TestState | undefined;
  onTest(): void;
  onToggle(next: boolean): void;
  onEdit(): void;
  onRemove(): void;
}) {
  const t = useT();
  const manageable = isManageableMcpName(row.name);
  // 只有 omp 自己的文件（用户级 mcp.json、项目 .omp/mcp.json）里的、名字能被 omp 命令管理的服务器能编辑和删除；别的工具的配置只读。
  const removable = manageable && (row.scope === "user" || row.scope === "project");
  const scopeText =
    row.scope === "user"
      ? t("integrations.scope.user")
      : row.scope === "project"
        ? t("integrations.scope.project")
        : row.scope;
  // 卡片（.ui-cards）：说明和"测试连接"成功的结果写在元信息下面；连不上时右上角一个红色徽标，omp 的原话在悬停里。
  const failed = test !== undefined && test !== "running" && !test.connected ? test.message : null;
  return (
    <ListRow
      testId={`mcp-row-${row.name}`}
      icon={monogram(row.name)}
      title={row.name}
      badges={
        <>
          {showScope && scopeText !== "" && <Badge>{scopeText}</Badge>}
          {failed !== null && (
            <Badge tone="error" title={failed} testId={`mcp-test-failed-${row.name}`}>
              {t("integrations.mcp.testFailed")}
            </Badge>
          )}
        </>
      }
      meta={
        <>
          {[row.transport, row.target].filter((part) => part !== "").join(" · ")}
          {!manageable && <span className="ig-card-note">{t("integrations.mcp.unmanageable")}</span>}
          {test !== undefined && test !== "running" && test.connected && (
            <span className="ig-card-note" role="status" data-testid={`mcp-test-result-${row.name}`}>
              {t("integrations.mcp.connected", { count: test.toolCount }) +
                (test.tools.length > 0 ? `：${test.tools.join(", ")}` : "")}
            </span>
          )}
        </>
      }
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
            label={
              removable
                ? t("integrations.more")
                : manageable
                  ? t("integrations.mcp.edit.external")
                  : t("integrations.mcp.unmanageable")
            }
            disabled={busy || !removable}
            testId={`mcp-more-${row.name}`}
            items={[
              {
                id: "edit",
                label: t("integrations.mcp.edit"),
                testId: `mcp-edit-${row.name}`,
                onSelect: onEdit,
              },
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
  );
}

export function McpCard({ scope }: { scope: ScopeKey }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = mcpResource.useLoad(scope);
  const { slot: adding, open: openAdding, closed: addingClosed, reset: resetAdding } = useDialogSlot();
  // 确认框用 slot：上一个还在放退出动画时再点移除也能立刻开新的（旧的迟到的关闭通知按 key 对不上）。
  const { slot: removing, open: openRemoving, closed: removingClosed } = useDialogSlot<McpServerRow>();
  const {
    slot: editing,
    open: openEditing,
    closed: editingClosed,
    reset: resetEditing,
  } = useDialogSlot<McpServerFile>();
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { busy, run } = useAsyncAction((error) => setFailure(errorDetail(error)));

  useEffect(() => {
    if (ready) void mcpResource.load(scope);
  }, [ready, scope]);
  // 换范围：关掉添加 / 编辑对话框、清掉上一个范围的失败提示。
  useEffect(() => {
    resetAdding();
    resetEditing();
    setFailure(null);
  }, [scope, resetAdding, resetEditing]);

  const data = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  const write = (job: () => Promise<{ ok: boolean; message: string }>) =>
    run(async () => {
      setFailure(null);
      const outcome = await job();
      if (outcome.ok) pushToast({ message: outcome.message });
      else setFailure(outcome.message);
    });

  /** 编辑：初值从 omp 的 mcp.json 里读（token 只给"有没有"）；读不了就把原因写在卡片下面，不开表单。 */
  const startEdit = (row: McpServerRow) => {
    if (row.scope !== "user" && row.scope !== "project") return;
    const fileScope = row.scope;
    return run(async () => {
      setFailure(null);
      const outcome = await window.studio.getMcpServerFile(row.name, fileScope, scopeProject(scope));
      if (outcome.ok) openEditing(outcome.value);
      else setFailure(t(`integrations.mcp.err.${outcome.code}` satisfies `integrations.mcp.err.${McpEditErrorCode}`));
    });
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
    <div className="st-section" data-testid="mcp-card">
      <SectionHead
        title={<TitleTip title={t("integrations.mcp.title")} tip={t("integrations.mcp.note")} />}
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
      {ready && data === null && load.kind !== "error" && (
        <Skeleton variant="card" label={t("integrations.loading")} testId="mcp-skeleton" />
      )}
      {data?.servers.length === 0 && data.unparsed.length === 0 && (
        <p className="ig-note" data-testid="mcp-empty">
          {t("integrations.mcp.empty")}
        </p>
      )}
      {data !== null && data.servers.length > 0 && (
        <div className="ui-cards ui-data-in">
          {data.servers.map((row) => (
            <McpRow
              key={`${row.scope}:${row.name}`}
              row={row}
              busy={busy}
              showScope={scope !== "user"}
              test={tests[row.name]}
              onTest={() => void runTest(row.name)}
              onToggle={(next) =>
                void write(() => runMcpWrite({ kind: "mcp", op: next ? "enable" : "disable", name: row.name }, scope))
              }
              onEdit={() => void startEdit(row)}
              onRemove={() => openRemoving(row)}
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
      {editing !== null && (
        <McpForm
          key={editing.key}
          scopeKey={scope}
          edit={editing.value}
          onDone={(message) => {
            editingClosed(editing.key);
            if (message !== null) pushToast({ message });
          }}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          key={removing.key}
          danger
          title={t("integrations.mcp.remove.title", { name: removing.value.name })}
          body={t("integrations.mcp.remove.body", {
            scope: removing.value.scope === "project" ? t("integrations.scope.project") : t("integrations.scope.user"),
          })}
          confirmLabel={t("integrations.remove")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const row = removing.value;
            removingClosed(removing.key);
            const target = row.scope;
            if (target === "user" || target === "project")
              void write(() => runMcpWrite({ kind: "mcp", op: "remove", name: row.name, scope: target }, scope));
          }}
          onCancel={() => removingClosed(removing.key)}
        />
      )}
    </div>
  );
}
