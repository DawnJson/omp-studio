// 设置 → Provider 与订阅 里的一个 provider（ui/ListRow：页面上排成卡片，选择对话框里是一行；图标是 provider 的 logo）。
// 徽标按凭据来源分（2026-10-24 仓库所有者要的）：OAuth 账号"已登录"，凭据库里的 API key"已设置 key"，
// omp 认为可用但凭据库里没有账号的（环境变量、`.env`、models.yml 的 apiKey）"已配置"；动作是 sm 按钮（spec §4.20）。
// 设置页填的 API key 存在 omp 的凭据库里，是一条 `type: "api_key"` 的账号：只有 key 账号时"退出"写成"清除 key"。
// 登录 / 填 key / 选账号都交给 ProviderFlowDialog；这里只直接做"只有一个账号时退出"这个不需要输入的动作。
import type { LoginKind } from "../../../../shared/provider-login.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { acceptsApiKey, type ProviderKeyEnv } from "../../../../shared/provider-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, ListRow } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import type { FlowAction } from "./ProviderFlowDialog.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import { useAsyncAction } from "./use-async-action.ts";

interface ProviderRowProps {
  provider: LoginProvider;
  accounts: LogoutAccount[];
  /** 这个 provider 登录是什么形式（OAuth 授权 / 粘贴 API key / 只能在终端），见 shared/provider-login.ts。 */
  loginKind: LoginKind;
  /** key 实际取自哪个变量（accounts-store 的 keyEnv）；"已配置"的元信息写它。选择对话框里的行都没连接，不传。 */
  keyEnv?: ProviderKeyEnv | undefined;
  /** 卡片上只写主名称：去掉括号里的补充（"Anthropic (Claude Pro/Max)" → "Anthropic"）；选择对话框里要区分同名的几项，写全名。 */
  shortName?: boolean;
  onFlow(provider: LoginProvider, action: FlowAction): void;
  onChanged(): void;
}

export function ProviderRow({
  provider,
  accounts,
  loginKind,
  keyEnv,
  shortName = false,
  onFlow,
  onChanged,
}: ProviderRowProps) {
  const t = useT();
  const { busy, run } = useAsyncAction((error) => reportError(t, error));

  const signedIn = provider.authenticated && accounts.length > 0;
  const hasKey = accounts.some((account) => account.type === "api_key");
  const hasOauth = accounts.some((account) => account.type === "oauth");
  const accountText =
    accounts.length > 1 ? `${accounts[0]?.label ?? ""} +${accounts.length - 1}` : (accounts[0]?.label ?? "");
  const name = (shortName && provider.name.replace(/\s*[(（][^)）]*[)）]/g, "").trim()) || provider.name;
  const withEnv = (source: string) => (keyEnv === undefined ? source : `${source} · ${keyEnv.name}`);

  let badge: { tone: "success" | "neutral"; text: string } | null;
  let meta: string;
  if (provider.authenticated) {
    badge = {
      tone: "success",
      text: hasOauth ? t("login.badge.signedIn") : hasKey ? t("login.badge.key") : t("login.badge.configured"),
    };
    meta = signedIn ? accountText : withEnv(t("login.badge.env"));
  } else if (!provider.available) {
    badge = { tone: "neutral", text: t("login.unavailable") };
    meta = "";
  } else {
    // 选择对话框里的行都是没连接的，"未登录"徽标没有信息；多步登录点"登录"后自然会看到，也不写。
    badge = null;
    meta = "";
  }

  // 没有任何动作时（比如只有环境变量里的 key）不给 actions，ListRow 据此标 data-no-actions，卡片里不留动作那一行。
  const hasActions = acceptsApiKey(provider.id) || signedIn || loginKind === "oauth" || loginKind === "terminal";
  return (
    <ListRow
      testId={`provider-${provider.id}`}
      icon={<ProviderLogo id={provider.id} name={provider.name} />}
      title={name}
      badges={badge === null ? undefined : <Badge tone={badge.tone}>{badge.text}</Badge>}
      meta={meta === "" ? undefined : meta}
      actions={
        hasActions ? (
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
                    ? void run(async () => {
                        await window.studio.logout(provider.id, accounts[0]?.credentialId ?? 0);
                        onChanged();
                      })
                    : onFlow(provider, "accounts")
                }
                testId={`provider-signout-${provider.id}`}
              >
                {hasOauth ? t("login.signOut") : t("login.apiKey.remove")}
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
        ) : undefined
      }
    />
  );
}
