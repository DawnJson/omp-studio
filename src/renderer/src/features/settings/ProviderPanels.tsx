// 提供商登录对话框里的几种内容：OAuth 进度、选账号、输入 API key、失败。状态和动作都由 ProviderFlowDialog 持有，这里只画正文；按钮在对话框页脚。
import type { LoginEvent } from "../../../../shared/ipc.ts";
import type { LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { ProviderKeyEnv } from "../../../../shared/provider-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Badge, Button, FormField, TextField } from "../../ui/controls.tsx";

/** omp 发来的进度提示，按到达顺序保留（登录失败时能看出走到了哪一步）。 */
export type ProgressEntry = Extract<LoginEvent, { type: "progress" }>;

interface LoginProgress {
  url?: string | undefined;
  launchUrl?: string | undefined;
  instructions?: string | undefined;
  progress?: ProgressEntry[] | undefined;
  input?: { inputId: string; title: string; placeholder?: string } | undefined;
}

export type Flow =
  | { kind: "idle" }
  | ({ kind: "login" } & LoginProgress)
  | { kind: "failed"; message: string }
  | { kind: "accounts" }
  | { kind: "key" }
  /** 应用内终端登录：临时 omp 的登录窗（TerminalLoginBody）。 */
  | { kind: "terminal" };

export function LoginBody({
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
    <div className="pv-flow" role="status">
      {flow.url === undefined ? (
        <p className="pv-text">{t("login.opening")}</p>
      ) : (
        <FormField label={t("login.fallback")}>
          <div className="pv-line">
            <TextField
              mono
              readOnly
              width="100%"
              value={flow.launchUrl ?? flow.url}
              onChange={() => undefined}
              onFocus={(event) => event.target.select()}
              aria-label={t("login.fallback")}
            />
            <Button onClick={() => onCopy(flow.launchUrl ?? flow.url ?? "")}>
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
            <Button onClick={() => void window.studio.openExternal(flow.url ?? "")}>{t("login.reopen")}</Button>
          </div>
        </FormField>
      )}
      {flow.instructions && <p className="pv-text pv-muted">{flow.instructions}</p>}
      {flow.progress !== undefined && flow.progress.length > 0 && (
        <ul className="pv-progress" data-testid="login-progress">
          {flow.progress.map((entry, index) => (
            <li key={index} className="pv-text pv-progress-item" data-level={entry.level}>
              {entry.message}
            </li>
          ))}
        </ul>
      )}
      {flow.input && (
        <FormField label={flow.input.title}>
          <TextField
            width="100%"
            autoComplete="off"
            data-autofocus=""
            value={code}
            placeholder={flow.input.placeholder ?? t("login.pasteCode")}
            aria-label={flow.input.title}
            onChange={onCode}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (code.trim() !== "" && flow.input) onSubmitCode(flow.input.inputId);
            }}
          />
        </FormField>
      )}
    </div>
  );
}

export function AccountsBody({
  accounts,
  busy,
  onPick,
}: {
  accounts: LogoutAccount[];
  busy: boolean;
  onPick(credentialId: number): void;
}) {
  const t = useT();
  return (
    <div className="pv-flow">
      <p className="pv-text">{t("login.chooseAccount")}</p>
      <div className="pv-accounts">
        {accounts.map((account) => (
          <button
            key={account.credentialId}
            type="button"
            className="pv-account"
            disabled={busy}
            onClick={() => onPick(account.credentialId)}
          >
            <span>
              {account.label}
              {account.active && (
                <>
                  {" "}
                  <Badge tone="accent" testId={`account-active-${account.credentialId}`}>
                    {t("login.accountActive")}
                  </Badge>
                </>
              )}
            </span>
            <span className="pv-muted">{account.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 填 API key。`keyEnv` 是 omp 实际取 key 的那个变量（provider-keys.ts 的 providerKeyEnv，和列表一起读好，打开时说明就是对的）：
 * 写在 agent 目录 `.env` 里时 key 改写那一行（omp 优先用 `.env`，主进程 saveApiKey），设在系统环境变量里时提示这里存的不生效；
 * 都没有时存进凭据库。已经有 key（`.env` 里或凭据库里）时输入框写"留空保持不变"。
 */
export function KeyBody({
  keyEnv,
  storedKey,
  value,
  onChange,
  onSubmit,
}: {
  keyEnv: ProviderKeyEnv | null;
  /** omp 凭据库里已有这个 provider 的 API key（listAccounts 里有 `api_key` 账号）。 */
  storedKey: boolean;
  value: string;
  onChange(next: string): void;
  onSubmit(): void;
}) {
  const t = useT();
  const note =
    keyEnv?.source === "env-file"
      ? t("login.apiKey.noteEnvFile", { name: keyEnv.name })
      : keyEnv?.source === "system"
        ? t("login.apiKey.noteSystem", { name: keyEnv.name })
        : t("login.apiKey.note");
  const placeholder =
    keyEnv?.source === "env-file"
      ? t("custom.form.key.envValue.keep")
      : keyEnv?.source !== "system" && storedKey
        ? t("login.apiKey.keepStored")
        : undefined;
  return (
    <div className="pv-flow">
      <FormField label={t("login.apiKey")} help={<span data-testid="provider-key-note">{note}</span>}>
        <TextField
          mono
          width="100%"
          type="password"
          autoComplete="off"
          data-autofocus=""
          value={value}
          placeholder={placeholder}
          aria-label={t("login.apiKey")}
          onChange={onChange}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (value.trim() !== "") onSubmit();
          }}
        />
      </FormField>
    </div>
  );
}

export function FailedBody({ message, terminalOnly }: { message: string; terminalOnly: boolean }) {
  const t = useT();
  return (
    <div className="pv-flow" role="alert">
      <p className={terminalOnly ? "pv-text pv-muted" : "pv-text pv-error"}>
        {terminalOnly ? t("login.terminalOnly") : message}
      </p>
    </div>
  );
}
