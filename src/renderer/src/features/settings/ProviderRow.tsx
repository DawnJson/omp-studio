// 设置 → Provider 与订阅 里的一个 provider（ui/ListRow：页面上排成卡片，选择对话框里是一行；图标是 provider 的 logo）。
// 徽标按凭据来源分（2026-10-24 仓库所有者要的）：OAuth 账号"已登录"，凭据库里的 API key"已设置 key"，
// omp 认为可用但凭据库里没有账号的（环境变量、`.env`、models.yml 的 apiKey）"已配置"（spec §4.20）。
// 卡片上的动作是图标按钮，和自定义提供商的卡片一致（2026-11-11 仓库所有者定）：添加账号 · 钥匙（设置 / 更换 key）· 登录或退出，
// 有哪个画哪个，一起靠右（不留空位，仓库所有者定，2026-11-11）；选择对话框里是 sm 文字按钮。
// 设置页填的 API key 存在 omp 的凭据库里，是一条 `type: "api_key"` 的账号：只有 key 账号时"退出"写成"清除 key"。
// 登录 / 填 key / 选账号都交给 ProviderFlowDialog；这里只直接做"只有一个账号时退出"这个不需要输入的动作。
import type { ReactNode } from "react";
import type { LoginKind } from "../../../../shared/provider-login.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { acceptsApiKey, type ProviderKeyEnv } from "../../../../shared/provider-keys.ts";
import { accountSummary } from "../../../../shared/ui/provider-list.ts";
import { useT } from "../../i18n/use-t.ts";
import { KeyIcon, SignIn, SignOut, UserPlus } from "../../icons.tsx";
import { Badge, Button, IconButton, ListRow } from "../../ui/controls.tsx";
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
  /** 页面上的卡片：只写主名称，去掉括号里的补充（"Anthropic (Claude Pro/Max)" → "Anthropic"），动作是图标按钮。
   *  选择对话框里要区分同名的几项，写全名；文字按钮并排，直接选登录方式。 */
  card?: boolean;
  onFlow(provider: LoginProvider, action: FlowAction): void;
  onChanged(): void;
}

export function ProviderRow({
  provider,
  accounts,
  loginKind,
  keyEnv,
  card = false,
  onFlow,
  onChanged,
}: ProviderRowProps) {
  const t = useT();
  const { busy, run } = useAsyncAction((error) => reportError(t, error));

  const signedIn = provider.authenticated && accounts.length > 0;
  const hasKey = accounts.some((account) => account.type === "api_key");
  const hasOauth = accounts.some((account) => account.type === "oauth");
  const accountText = accountSummary(accounts.map((account) => account.label));
  const name = (card && provider.name.replace(/\s*[(（][^)）]*[)）]/g, "").trim()) || provider.name;
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

  const withKey = acceptsApiKey(provider.id);
  const keyLabel = hasKey ? t("login.apiKey.replace") : t("login.apiKey.set");
  const signOut = () =>
    accounts.length === 1 && accounts[0]
      ? void run(async () => {
          await window.studio.logout(provider.id, accounts[0]?.credentialId ?? 0);
          onChanged();
        })
      : onFlow(provider, "accounts");
  // 登录 / 退出：有账号时退出（只有 key 账号时是清除 key）；没账号时按登录方式登录（多步登录在应用内起一个临时的 omp，TerminalLoginBody）。
  const account: { label: string; testId: string; disabled: boolean; signIn: boolean; onClick(): void } | null =
    signedIn
      ? {
          label: hasOauth ? t("login.signOut") : t("login.apiKey.remove"),
          testId: `provider-signout-${provider.id}`,
          disabled: busy,
          signIn: false,
          onClick: signOut,
        }
      : loginKind === "oauth" || loginKind === "terminal"
        ? {
            label: t("login.signIn"),
            testId: `provider-${loginKind === "oauth" ? "login" : "terminal-login"}-${provider.id}`,
            disabled: busy || !provider.available,
            signIn: true,
            onClick: () => onFlow(provider, loginKind === "oauth" ? "login" : "terminal"),
          }
        : null;
  // 已用 OAuth 登录的再登录一次是加一个账号（omp 按账号身份去重：同一个账号只是刷新，见 docs/architecture/login.md「多个账号」）。
  const addAccount: FlowAction | null =
    hasOauth && provider.available
      ? loginKind === "oauth"
        ? "login"
        : loginKind === "terminal"
          ? "terminal"
          : null
      : null;

  let actions: ReactNode;
  if (card) {
    actions = (
      <>
        {addAccount !== null && (
          <IconButton
            label={t("login.addAccount")}
            disabled={busy}
            onClick={() => onFlow(provider, addAccount)}
            testId={`provider-add-account-${provider.id}`}
          >
            <UserPlus size={14} />
          </IconButton>
        )}
        {withKey && (
          <IconButton
            label={keyLabel}
            disabled={busy}
            onClick={() => onFlow(provider, "key")}
            testId={`provider-key-${provider.id}`}
          >
            <KeyIcon size={14} />
          </IconButton>
        )}
        {account !== null && (
          <IconButton
            label={account.label}
            disabled={account.disabled}
            onClick={account.onClick}
            testId={account.testId}
          >
            {account.signIn ? <SignIn size={14} /> : <SignOut size={14} />}
          </IconButton>
        )}
      </>
    );
  } else {
    actions = (
      <>
        {withKey && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onFlow(provider, "key")}
            testId={`provider-key-${provider.id}`}
          >
            {keyLabel}
          </Button>
        )}
        {account !== null && (
          <Button size="sm" disabled={account.disabled} onClick={account.onClick} testId={account.testId}>
            {account.label}
          </Button>
        )}
      </>
    );
  }
  return (
    <ListRow
      testId={`provider-${provider.id}`}
      icon={<ProviderLogo id={provider.id} name={provider.name} />}
      title={name}
      badges={badge === null ? undefined : <Badge tone={badge.tone}>{badge.text}</Badge>}
      meta={meta === "" ? undefined : meta}
      actions={actions}
    />
  );
}
