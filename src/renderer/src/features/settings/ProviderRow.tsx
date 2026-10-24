// 设置 → Provider 与订阅 里的一个 provider（ui/ListRow：页面上排成卡片，选择对话框里是一行；图标是 provider 的 logo）。连上了的徽标一律"已登录"
// （卡片右上角），怎么连上的（账号、环境变量）写在元信息里；动作是 sm 按钮（spec §4.20）。
// 设置页填的 API key 存在 omp 的凭据库里，是一条 `type: "api_key"` 的账号：和 OAuth 账号一样显示、一样"退出"（清掉它）。
// 登录 / 填 key / 选账号都交给 ProviderFlowDialog；这里只直接做"只有一个账号时退出"这个不需要输入的动作。
import { useState } from "react";
import type { LoginKind } from "../../../../shared/provider-login.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { acceptsApiKey, apiKeyEnvName } from "../../../../shared/provider-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, ListRow } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import type { FlowAction } from "./ProviderFlowDialog.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";

interface ProviderRowProps {
  provider: LoginProvider;
  accounts: LogoutAccount[];
  /** 这个 provider 登录是什么形式（OAuth 授权 / 粘贴 API key / 只能在终端），见 shared/provider-login.ts。 */
  loginKind: LoginKind;
  /** 卡片上只写主名称：去掉括号里的补充（"Anthropic (Claude Pro/Max)" → "Anthropic"）；选择对话框里要区分同名的几项，写全名。 */
  shortName?: boolean;
  onFlow(provider: LoginProvider, action: FlowAction): void;
  onChanged(): void;
}

export function ProviderRow({ provider, accounts, loginKind, shortName = false, onFlow, onChanged }: ProviderRowProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const signedIn = provider.authenticated && accounts.length > 0;
  const envName = apiKeyEnvName(provider.id);
  const hasKey = accounts.some((account) => account.type === "api_key");
  const accountText =
    accounts.length > 1 ? `${accounts[0]?.label ?? ""} +${accounts.length - 1}` : (accounts[0]?.label ?? "");
  const name = (shortName && provider.name.replace(/\s*[(（][^)）]*[)）]/g, "").trim()) || provider.name;
  const withEnv = (source: string) => (envName === null ? source : `${source} · ${envName}`);

  let badge: { tone: "success" | "neutral"; text: string };
  let meta: string;
  if (provider.authenticated) {
    badge = { tone: "success", text: t("login.badge.signedIn") };
    meta = signedIn ? accountText : withEnv(t("login.badge.env"));
  } else if (!provider.available) {
    badge = { tone: "neutral", text: t("login.unavailable") };
    meta = "";
  } else {
    badge = { tone: "neutral", text: t("login.notSignedIn") };
    meta =
      loginKind === "oauth"
        ? t("login.kind.oauth")
        : loginKind === "terminal"
          ? t("login.kind.interactive")
          : t("login.kind.apiKey");
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
      title={name}
      badges={<Badge tone={badge.tone}>{badge.text}</Badge>}
      meta={meta === "" ? undefined : meta}
      actions={
        <>
          {acceptsApiKey(provider.id) && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onFlow(provider, "key")}
              testId={`provider-key-${provider.id}`}
            >
              {hasKey ? t("login.apiKey.replace") : t("login.apiKey.set")}
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
          ) : loginKind === "terminal" ? (
            // 要多步交互的 provider：rpc 的 login 被 omp 拒绝，在应用内起一个临时的 omp 走它自己的登录流程（TerminalLoginBody）。
            <Button
              size="sm"
              disabled={busy || !provider.available}
              onClick={() => onFlow(provider, "terminal")}
              testId={`provider-terminal-login-${provider.id}`}
            >
              {t("login.signIn")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
