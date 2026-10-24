// 设置 → 提供商与账号：已连接的提供商 + 自定义提供商（models.yml）。omp 列出 80 多个提供商，没连接的不在页面上铺开：
// "已连接"标题行右侧的"连接提供商…"打开可搜索的选择对话框，选中后走登录 / 填 key 对话框。
import { useCallback, useEffect, useMemo } from "react";
import type { LoginProvider } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { loginKind } from "../../../../shared/provider-login.ts";
import { splitProviders } from "../../../../shared/ui/provider-list.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { Button, Notice, SectionHead } from "../../ui/controls.tsx";
import { describeError } from "../../ui/errors.ts";
import { useDialogSlot } from "../../ui/presence.ts";
import { loadAccounts, useAccountLoad } from "./accounts-store.ts";
import { CustomProviders } from "./CustomProviders.tsx";
import { ProviderFlowDialog, type FlowAction } from "./ProviderFlowDialog.tsx";
import { ProviderPickDialog } from "./ProviderPickDialog.tsx";
import { ProviderRow } from "./ProviderRow.tsx";
import "./providers.css";

type DialogTarget = { kind: "pick" } | { kind: "flow"; providerId: string; action: FlowAction; fromPick: boolean };

export function ProvidersSection() {
  const t = useT();
  const load = useAccountLoad();
  const data = load.kind === "ready" ? load.data : null;
  const error = load.kind === "error" ? load.error : null;
  const { slot: dialog, open: openDialog, closed: dialogClosed } = useDialogSlot<DialogTarget>();
  const groups = useMemo(() => (data ? splitProviders(data.providers, "") : { configured: [], others: [] }), [data]);

  // 有缓存就直接显示，进入时后台刷新一次。
  const enter = useCallback(() => void loadAccounts(), []);
  useEffect(enter, [enter]);
  // 登录/退出/改 key 之后必须重读，不能并进改动之前发起的旧读取。
  const reload = useCallback(() => void loadAccounts(true), []);

  const openFlow = (provider: LoginProvider, action: FlowAction, fromPick: boolean) =>
    openDialog({ kind: "flow", providerId: provider.id, action, fromPick });
  const target = dialog?.value ?? null;
  const flowProvider =
    target?.kind === "flow" ? (data?.providers.find((provider) => provider.id === target.providerId) ?? null) : null;

  const row = (provider: LoginProvider) => (
    <ProviderRow
      key={provider.id}
      provider={provider}
      accounts={data?.accounts[provider.id] ?? []}
      loginKind={loginKind(provider.id)}
      shortName
      onFlow={(target, action) => openFlow(target, action, false)}
      onChanged={reload}
    />
  );

  return (
    <>
      <div data-testid="providers">
        {/* "连接 provider..."放在"已连接"这一行的右侧（和下面"自定义提供商"的按钮同一种位置）。 */}
        <SectionHead
          title={t("login.connected")}
          count={data === null ? undefined : groups.configured.length}
          actions={
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={data === null || groups.others.length === 0}
              onClick={() => openDialog({ kind: "pick" })}
              testId="providers-connect"
            >
              {t("login.connect")}
            </Button>
          }
        />
        {error !== null && (
          <Notice tone="error" testId="providers-load-failed">
            {t("login.loadFailed", { message: describeError(t, error) })}
          </Notice>
        )}
        {load.kind === "ready" && load.refreshError !== null && (
          <Notice tone="warning" testId="providers-refresh-failed">
            {t("login.refreshFailed", { message: describeError(t, load.refreshError) })}
          </Notice>
        )}
        {error === null && data === null && <p className="pv-text pv-muted">{t("settings.modelsLoading")}</p>}
        {data?.providers.length === 0 && <p className="pv-text pv-muted">{t("login.empty")}</p>}
        {data !== null && data.providers.length > 0 && groups.configured.length === 0 && (
          <p className="pv-text pv-muted" data-testid="providers-none-connected">
            {t("login.connected.empty")}
          </p>
        )}
        {groups.configured.length > 0 && <div className="ui-cards">{groups.configured.map(row)}</div>}
      </div>

      <CustomProviders />

      {dialog?.value.kind === "pick" && data !== null && (
        <ProviderPickDialog
          key={dialog.key}
          providers={groups.others}
          accounts={data.accounts}
          onFlow={(provider, action) => openFlow(provider, action, true)}
          onClose={() => dialogClosed(dialog.key)}
        />
      )}
      {dialog !== null && target?.kind === "flow" && flowProvider !== null && data !== null && (
        <ProviderFlowDialog
          key={dialog.key}
          provider={flowProvider}
          accounts={data.accounts[flowProvider.id] ?? []}
          action={target.action}
          onBack={target.fromPick ? () => openDialog({ kind: "pick" }) : undefined}
          onClose={() => dialogClosed(dialog.key)}
          onChanged={reload}
        />
      )}
    </>
  );
}
