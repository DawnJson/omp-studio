// 设置 → Provider 与订阅 里的一个 provider（ui/ListRow：页面上排成卡片，选择对话框里是一行；图标是 provider 的 logo），状态是徽标，动作是 sm 按钮，清除 key 收进 ⋯（spec §4.20）。
// 登录 / 填 key / 选账号都交给 ProviderFlowDialog；这里只直接做"只有一个账号时退出"和"清除 key"两个不需要输入的动作。
import { useState } from "react";
import type { LoginKind } from "../../../../shared/provider-login.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, ListRow } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import type { FlowAction } from "./ProviderFlowDialog.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import { RowMenu } from "./RowMenu.tsx";

interface ProviderRowProps {
  provider: LoginProvider;
  accounts: LogoutAccount[];
  hasStoredKey: boolean;
  /** 这个 provider 有已知的环境变量名，可以由 omp-studio 存 API key。 */
  canSetKey: boolean;
  /** 这个 provider 登录是什么形式（OAuth 授权 / 粘贴 API key / 只能在终端），见 shared/provider-login.ts。 */
  loginKind: LoginKind;
  onFlow(provider: LoginProvider, action: FlowAction): void;
  onChanged(): void;
}

export function ProviderRow({
  provider,
  accounts,
  hasStoredKey,
  canSetKey,
  loginKind,
  onFlow,
  onChanged,
}: ProviderRowProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const signedIn = provider.authenticated && accounts.length > 0;
  const envName = apiKeyEnvName(provider.id);
  const accountText =
    accounts.length > 1 ? `${accounts[0]?.label ?? ""} +${accounts.length - 1}` : (accounts[0]?.label ?? "");

  let badge: { tone: "success" | "neutral"; text: string };
  let meta: string;
  if (signedIn) {
    badge = { tone: "success", text: t("login.badge.signedIn") };
    meta = accountText;
  } else if (provider.authenticated || hasStoredKey) {
    badge = hasStoredKey
      ? { tone: "success", text: t("login.keyInApp") }
      : { tone: "neutral", text: t("login.badge.env") };
    meta = envName ?? "";
  } else if (loginKind === "terminal") {
    badge = { tone: "neutral", text: t("login.terminalLogin") };
    meta = t("login.terminalOnly");
  } else if (!provider.available) {
    badge = { tone: "neutral", text: t("login.unavailable") };
    meta = "";
  } else {
    badge = { tone: "neutral", text: t("login.notSignedIn") };
    meta = loginKind === "oauth" ? t("login.kind.oauth") : t("login.kind.apiKey");
  }

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
      onChanged();
    } catch (error) {
      reportError(t, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ListRow
      testId={`provider-${provider.id}`}
      icon={<ProviderLogo id={provider.id} name={provider.name} />}
      title={provider.name}
      badges={<Badge tone={badge.tone}>{badge.text}</Badge>}
      meta={meta === "" ? undefined : meta}
      actions={
        <>
          {canSetKey && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onFlow(provider, "key")}
              testId={`provider-key-${provider.id}`}
            >
              {hasStoredKey ? t("login.apiKey.replace") : t("login.apiKey.set")}
            </Button>
          )}
          {signedIn ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                accounts.length === 1 && accounts[0]
                  ? void run(() => window.studio.logout(provider.id, accounts[0]?.credentialId ?? 0))
                  : onFlow(provider, "accounts")
              }
              testId={`provider-signout-${provider.id}`}
            >
              {t("login.signOut")}
            </Button>
          ) : loginKind === "oauth" ? (
            <Button
              size="sm"
              disabled={busy || !provider.available}
              onClick={() => onFlow(provider, "login")}
              testId={`provider-login-${provider.id}`}
            >
              {t("login.signIn")}
            </Button>
          ) : loginKind === "api-key" && !canSetKey ? (
            // 这个 provider 的登录就是粘贴 API key，studio 又没有它的环境变量名：走 omp 自己的 login，key 存进 omp 的凭据库。
            <Button
              size="sm"
              disabled={busy || !provider.available}
              onClick={() => onFlow(provider, "login")}
              testId={`provider-login-${provider.id}`}
            >
              {t("login.apiKey.add")}
            </Button>
          ) : null}
          {hasStoredKey && (
            <RowMenu
              label={t("login.more")}
              disabled={busy}
              testId={`provider-more-${provider.id}`}
              items={[
                {
                  id: "clear-key",
                  label: t("login.apiKey.clear"),
                  tone: "danger",
                  testId: `provider-clear-key-${provider.id}`,
                  onSelect: () => void run(() => window.studio.clearApiKey(provider.id)),
                },
              ]}
            />
          )}
        </>
      }
    />
  );
}
