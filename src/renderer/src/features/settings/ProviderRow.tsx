// 设置 → 提供商与账号 里的一个提供商：状态、登录/退出登录、API key（spec §4.20）。
// OAuth 登录：行内展开进度卡（打开浏览器、可复制的链接、授权码输入）；登录的过程事件由主进程经 onLogin 推来。
import { describeError } from "../../ui/errors.ts";
import { useRef, useState } from "react";
import type { LoginEvent } from "../../../../shared/ipc.ts";
import type { LoginKind } from "../../../../shared/provider-login.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "./controls.tsx";
import { AccountsCard, FailedCard, KeyForm, LoginCard, type Flow } from "./ProviderPanels.tsx";

interface ProviderRowProps {
  provider: LoginProvider;
  accounts: LogoutAccount[];
  hasStoredKey: boolean;
  /** 这个 provider 有已知的环境变量名，可以由 omp-studio 存 API key。 */
  canSetKey: boolean;
  /** 这个 provider 登录是什么形式（OAuth 授权 / 粘贴 API key / 只能在终端），见 shared/provider-login.ts。 */
  loginKind: LoginKind;
  /** 别的提供商正在登录。 */
  blocked: boolean;
  onLoginActive(active: boolean): void;
  onChanged(): void;
}

export function ProviderRow({
  provider,
  accounts,
  hasStoredKey,
  canSetKey,
  loginKind,
  blocked,
  onLoginActive,
  onChanged,
}: ProviderRowProps) {
  const t = useT();
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);

  const signedIn = provider.authenticated && accounts.length > 0;
  const status = signedIn
    ? {
        text: t("login.signedIn", {
          account:
            accounts.length > 1 ? `${accounts[0]?.label ?? ""} +${accounts.length - 1}` : (accounts[0]?.label ?? ""),
        }),
        ok: true,
      }
    : provider.authenticated
      ? { text: hasStoredKey ? t("login.keyInApp") : t("login.viaEnv"), ok: true }
      : hasStoredKey
        ? { text: t("login.keyInApp"), ok: true }
        : {
            text:
              loginKind === "terminal"
                ? t("login.terminalLogin")
                : provider.available
                  ? t("login.notSignedIn")
                  : t("login.unavailable"),
            ok: false,
          };

  const fail = (error: unknown) => setFlow({ kind: "failed", message: describeError(t, error) });

  const startLogin = async () => {
    setFlow({ kind: "login" });
    setCode("");
    onLoginActive(true);
    const off = window.studio.onLogin((event: LoginEvent) => {
      setFlow((current) => {
        if (current.kind !== "login") return current;
        switch (event.type) {
          case "open_url":
            return {
              ...current,
              url: event.url,
              ...(event.launchUrl !== undefined && { launchUrl: event.launchUrl }),
              ...(event.instructions !== undefined && { instructions: event.instructions }),
            };
          case "progress":
            return { ...current, progress: event.message };
          case "input":
            return {
              ...current,
              input: {
                inputId: event.inputId,
                title: event.title,
                ...(event.placeholder !== undefined && { placeholder: event.placeholder }),
              },
            };
        }
      });
    });
    try {
      const outcome = await window.studio.startLogin(provider.id);
      if (outcome.ok) {
        setFlow({ kind: "idle" });
        onChanged();
      } else {
        setFlow(outcome.message === "cancelled" ? { kind: "idle" } : { kind: "failed", message: outcome.message });
      }
    } catch (error) {
      fail(error);
    } finally {
      off();
      onLoginActive(false);
    }
  };

  const signOut = async (credentialId: number) => {
    setBusy(true);
    try {
      await window.studio.logout(provider.id, credentialId);
      setFlow({ kind: "idle" });
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    try {
      await window.studio.saveApiKey(provider.id, apiKey);
      setApiKey("");
      setFlow({ kind: "idle" });
      onChanged();
    } catch (error) {
      setFlow({ kind: "failed", message: t("login.apiKey.failed", { message: describeError(t, error) }) });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    setBusy(true);
    try {
      await window.studio.clearApiKey(provider.id);
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const loggingIn = flow.kind === "login";
  const disabled = blocked || busy || loggingIn;

  return (
    <div className="st-block" data-testid={`provider-${provider.id}`}>
      <div className="st-provider-head">
        <div className="st-provider-name" title={provider.name}>
          {provider.name}
        </div>
        <div className="st-provider-status" data-tone={status.ok ? "ok" : undefined} title={status.text}>
          {status.text}
        </div>
        <div className="st-provider-actions">
          {canSetKey && !hasStoredKey && (
            <Button
              variant="text"
              disabled={disabled}
              onClick={() => {
                setFlow({ kind: "key" });
                setTimeout(() => keyInput.current?.focus());
              }}
            >
              {t("login.apiKey.set")}
            </Button>
          )}
          {hasStoredKey && (
            <Button variant="text" disabled={disabled} onClick={() => void clearKey()}>
              {t("login.apiKey.clear")}
            </Button>
          )}
          {signedIn ? (
            <Button
              disabled={disabled}
              onClick={() =>
                accounts.length === 1 && accounts[0]
                  ? void signOut(accounts[0].credentialId)
                  : setFlow({ kind: "accounts" })
              }
            >
              {t("login.signOut")}
            </Button>
          ) : loginKind === "oauth" ? (
            <Button disabled={disabled || !provider.available} loading={loggingIn} onClick={() => void startLogin()}>
              {t("login.signIn")}
            </Button>
          ) : loginKind === "api-key" && !canSetKey ? (
            // 这个 provider 的登录就是粘贴 API key，studio 又没有它的环境变量名：走 omp 自己的 login，key 存进 omp 的凭据库。
            <Button disabled={disabled || !provider.available} loading={loggingIn} onClick={() => void startLogin()}>
              {t("login.apiKey.add")}
            </Button>
          ) : null}
        </div>
      </div>

      {flow.kind === "login" && (
        <LoginCard
          flow={flow}
          code={code}
          copied={copied}
          maskInput={loginKind === "api-key"}
          onCode={setCode}
          onCopy={copy}
          onSubmitCode={(inputId) => {
            void window.studio.answerLoginInput(inputId, code.trim()).catch(fail);
            setCode("");
            setFlow((current) => (current.kind === "login" ? { ...current, input: undefined } : current));
          }}
        />
      )}
      {flow.kind === "accounts" && (
        <AccountsCard
          accounts={accounts}
          busy={busy}
          onPick={(id) => void signOut(id)}
          onCancel={() => setFlow({ kind: "idle" })}
        />
      )}
      {flow.kind === "key" && (
        <KeyForm
          value={apiKey}
          busy={busy}
          inputRef={keyInput}
          onChange={setApiKey}
          onSave={() => void saveKey()}
          onCancel={() => {
            setApiKey("");
            setFlow({ kind: "idle" });
          }}
        />
      )}
      {flow.kind === "failed" && (
        <FailedCard
          message={flow.message}
          copied={copied}
          disabled={disabled}
          onCopy={copy}
          onRetry={() => void startLogin()}
          onClose={() => setFlow({ kind: "idle" })}
        />
      )}
    </div>
  );
}
