// 提供商登录对话框里的几种内容：OAuth 进度、选账号、输入 API key、失败。状态和动作都由 ProviderFlowDialog 持有，这里只画正文；按钮在对话框页脚。
import { useEffect, useState } from "react";
import type { LoginEvent, TavilyKeyUsage } from "../../../../shared/ipc.ts";
import type { LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { ProviderKeyEnv } from "../../../../shared/provider-keys.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { Badge, Button, FormField, Textarea, TextField } from "../../ui/controls.tsx";
import { describeError } from "../../ui/errors.ts";
// 额度行和输入框旁"用量"对话框同一套样式（.uq-limit）。
import "../composer/usage.css";

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
 * `backup`：Tavily 另有"备用 key"（每行一个，当前 key 用完时当场换下一个），下面列出每个 key 的用量；只进不出，已存的只说个数。
 */
export function KeyBody({
  keyEnv,
  storedKey,
  value,
  onChange,
  onSubmit,
  backup,
}: {
  keyEnv: ProviderKeyEnv | null;
  /** omp 凭据库里已有这个 provider 的 API key（listAccounts 里有 `api_key` 账号）。 */
  storedKey: boolean;
  value: string;
  onChange(next: string): void;
  onSubmit(): void;
  backup: { count: number; value: string; onChange(next: string): void } | null;
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
      {backup !== null && (
        <FormField label={t("login.apiKey.backup")} help={t("login.apiKey.backup.note")}>
          <Textarea
            mono
            rows={3}
            value={backup.value}
            placeholder={
              backup.count > 0
                ? t("login.apiKey.backup.keep", { count: backup.count })
                : t("login.apiKey.backup.placeholder")
            }
            aria-label={t("login.apiKey.backup")}
            onChange={backup.onChange}
            testId="provider-backup-keys"
          />
        </FormField>
      )}
      {backup !== null && (
        <FormField label={t("login.apiKey.usage")}>
          <TavilyKeyUsageList />
        </FormField>
      )}
    </div>
  );
}

type UsageLoad = { kind: "loading" } | { kind: "ready"; rows: TavilyKeyUsage[] } | { kind: "failed"; error: unknown };

/** 打开对话框时查一次：omp 现在用的 key 在最上面，下面是备用 key（按换用顺序）。 */
function TavilyKeyUsageList() {
  const t = useT();
  const [load, setLoad] = useState<UsageLoad>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    window.studio.tavilyKeyUsage().then(
      (rows) => {
        if (live) setLoad({ kind: "ready", rows });
      },
      (error: unknown) => {
        if (live) setLoad({ kind: "failed", error });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  if (load.kind === "loading") return <p className="pv-text pv-muted">{t("login.apiKey.usage.loading")}</p>;
  if (load.kind === "failed")
    return (
      <p className="pv-text pv-error" role="alert">
        {t("login.apiKey.usage.failed", { message: describeError(t, load.error) })}
      </p>
    );
  if (load.rows.length === 0) return <p className="pv-text pv-muted">{t("login.apiKey.usage.none")}</p>;
  let backups = 0;
  return (
    <div className="pv-key-usage" data-testid="provider-key-usage">
      {load.rows.map((row, index) => (
        <KeyUsageRow
          key={index}
          row={row}
          name={
            row.role === "current"
              ? t("login.apiKey.usage.current")
              : t("login.apiKey.usage.backup", { n: (backups += 1) })
          }
        />
      ))}
    </div>
  );
}

/** 一个 key 一行：名称 | 剩余的条 | 剩余百分比 / 已用尽 / 无效 | 已用 / 上限。 */
function KeyUsageRow({ row, name }: { row: TavilyKeyUsage; name: string }) {
  const t = useT();
  const locale = useLocale();
  const left =
    row.used !== null && row.limit !== null && row.limit > 0
      ? Math.max(0, Math.round((1 - row.used / row.limit) * 100))
      : null;
  const status =
    row.state === "exhausted" || row.state === "invalid" ? "exhausted" : left !== null && left <= 10 ? "warning" : "ok";
  const text =
    row.state === "exhausted"
      ? t("usage.quota.exhausted")
      : row.state === "invalid"
        ? t("login.apiKey.usage.invalid")
        : left === null
          ? t("usage.quota.unknown")
          : t("usage.quota.left", { percent: left });
  const number = new Intl.NumberFormat(locale);
  const amount =
    row.used === null
      ? null
      : row.limit === null
        ? number.format(row.used)
        : `${number.format(row.used)} / ${number.format(row.limit)}`;
  return (
    <div className="uq-limit" data-testid="provider-key-usage-row" data-status={status}>
      <span className="uq-limit-name">{name}</span>
      <div
        className="uq-bar"
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(left !== null && { "aria-valuenow": left })}
      >
        <div className="uq-bar-fill" style={{ width: `${row.state === "ok" ? (left ?? 0) : 0}%` }} />
      </div>
      <span className="uq-limit-left">{text}</span>
      {amount !== null && <span className="uq-limit-reset">{amount}</span>}
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
