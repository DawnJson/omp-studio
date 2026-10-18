// 提供商行里展开的几种面板：OAuth 进度卡、选账号、输入 API key、失败。状态和动作都由 ProviderRow 持有，这里只画。
import type { RefObject } from "react";
import type { LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button } from "./controls.tsx";
import { InfoTip } from "./InfoTip.tsx";

export interface LoginProgress {
  url?: string | undefined;
  launchUrl?: string | undefined;
  instructions?: string | undefined;
  progress?: string | undefined;
  input?: { inputId: string; title: string; placeholder?: string } | undefined;
}

export type Flow =
  | { kind: "idle" }
  | ({ kind: "login" } & LoginProgress)
  | { kind: "failed"; message: string }
  | { kind: "accounts" }
  | { kind: "key" };

export function LoginCard({
  flow,
  code,
  copied,
  onCode,
  onCopy,
  onSubmitCode,
}: {
  flow: { kind: "login" } & LoginProgress;
  code: string;
  copied: boolean;
  onCode(value: string): void;
  onCopy(text: string): void;
  onSubmitCode(inputId: string): void;
}) {
  const t = useT();
  return (
    <div className="st-login" role="status">
      {flow.url === undefined ? (
        <span>{t("login.opening")}</span>
      ) : (
        <>
          <span>{t("login.fallback")}</span>
          <div className="st-login-line">
            <input
              className="st-input"
              data-mono=""
              readOnly
              value={flow.launchUrl ?? flow.url}
              onFocus={(event) => event.target.select()}
              aria-label={t("login.fallback")}
            />
            <Button onClick={() => onCopy(flow.launchUrl ?? flow.url ?? "")}>
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
            <Button onClick={() => void window.studio.openExternal(flow.url ?? "")}>{t("login.reopen")}</Button>
          </div>
          {flow.instructions && <span className="st-muted">{flow.instructions}</span>}
        </>
      )}
      {flow.progress && <span className="st-muted">{flow.progress}</span>}
      {flow.input && (
        <div className="st-login-line">
          <input
            className="st-input"
            autoFocus
            value={code}
            placeholder={flow.input.placeholder ?? t("login.pasteCode")}
            aria-label={flow.input.title}
            onChange={(event) => onCode(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={code.trim() === ""}
            onClick={() => flow.input && onSubmitCode(flow.input.inputId)}
          >
            {t("login.submit")}
          </Button>
        </div>
      )}
      <div className="st-login-actions">
        <Button variant="text" onClick={() => void window.studio.cancelLogin()}>
          {t("login.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function AccountsCard({
  accounts,
  busy,
  onPick,
  onCancel,
}: {
  accounts: LogoutAccount[];
  busy: boolean;
  onPick(credentialId: number): void;
  onCancel(): void;
}) {
  const t = useT();
  return (
    <div className="st-login">
      <span>{t("login.chooseAccount")}</span>
      <div className="st-accounts">
        {accounts.map((account) => (
          <button
            key={account.credentialId}
            type="button"
            className="st-account"
            disabled={busy}
            onClick={() => onPick(account.credentialId)}
          >
            <span>{account.label}</span>
            <span className="st-muted">{account.detail}</span>
          </button>
        ))}
      </div>
      <div className="st-login-actions">
        <Button variant="text" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function KeyForm({
  value,
  busy,
  inputRef,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange(next: string): void;
  onSave(): void;
  onCancel(): void;
}) {
  const t = useT();
  return (
    <form
      className="st-login"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "") onSave();
      }}
    >
      <div className="st-login-line">
        <input
          ref={inputRef}
          className="st-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t("login.apiKey.placeholder")}
          aria-label={t("login.apiKey")}
          onChange={(event) => onChange(event.target.value)}
        />
        <InfoTip>{t("login.apiKey.note")}</InfoTip>
        <Button variant="primary" disabled={value.trim() === ""} loading={busy} onClick={onSave}>
          {t("login.apiKey.save")}
        </Button>
        <Button variant="text" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function FailedCard({
  message,
  copied,
  disabled,
  onCopy,
  onRetry,
  onClose,
}: {
  message: string;
  copied: boolean;
  disabled: boolean;
  onCopy(text: string): void;
  onRetry(): void;
  onClose(): void;
}) {
  const t = useT();
  const terminalOnly = /secret|terminal/i.test(message);
  return (
    <div className="st-login" role="alert">
      <span className="st-error-text">{t("login.failed")}</span>
      <span className="st-muted">{terminalOnly ? t("login.terminalOnly") : message}</span>
      <div className="st-login-actions">
        {terminalOnly && (
          <Button onClick={() => onCopy("omp")}>{copied ? t("common.copied") : t("login.copyCommand")}</Button>
        )}
        <Button disabled={disabled} onClick={onRetry}>
          {t("common.retry")}
        </Button>
        <Button variant="text" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
