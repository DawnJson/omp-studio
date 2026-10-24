// "连接提供商…"：没连接的提供商不在页面上铺开（84 行），点页头按钮在这个对话框里按名称搜索，选中后走登录 / 填 key 的对话框。
import { useState } from "react";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { loginKind } from "../../../../shared/provider-login.ts";
import { matchesProvider } from "../../../../shared/ui/provider-list.ts";
import { useT } from "../../i18n/use-t.ts";
import { Search } from "../../icons.tsx";
import { Button, TextField } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import type { FlowAction } from "./ProviderFlowDialog.tsx";
import { ProviderRow } from "./ProviderRow.tsx";
import "./providers.css";

export function ProviderPickDialog({
  providers,
  accounts,
  onFlow,
  onClose,
}: {
  /** 还没连接的提供商。 */
  providers: readonly LoginProvider[];
  accounts: Readonly<Record<string, LogoutAccount[]>>;
  onFlow(provider: LoginProvider, action: FlowAction): void;
  /** 对话框退出动画放完、卸载时调用。 */
  onClose(): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const shown = providers.filter((provider) => matchesProvider(provider, query));

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={t("login.connect.title")}
      desc={t("login.connect.desc")}
      testId="provider-pick"
      lockHeight
      footer={<Button onClick={() => setOpen(false)}>{t("common.close")}</Button>}
    >
      <TextField
        type="search"
        width="100%"
        leading={<Search size={14} />}
        value={query}
        placeholder={t("login.search")}
        aria-label={t("login.search")}
        data-autofocus=""
        onChange={setQuery}
        testId="provider-search"
      />
      <div className="pv-pick-list" data-testid="provider-pick-list">
        {shown.length === 0 ? (
          <p className="pv-text pv-muted" data-testid="provider-no-match">
            {t("login.noMatch")}
          </p>
        ) : (
          shown.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              accounts={accounts[provider.id] ?? []}
              loginKind={loginKind(provider.id)}
              onFlow={onFlow}
              onChanged={() => undefined}
            />
          ))
        )}
      </div>
    </Dialog>
  );
}
