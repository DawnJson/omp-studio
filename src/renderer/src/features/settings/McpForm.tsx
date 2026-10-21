// 添加 MCP 服务器的表单：stdio（命令 + 每行一个参数）、http、sse（URL + 可选 token）。
// 参数一行一个，避免在界面里再做一遍"切词"：含空格的参数主进程拼命令时加引号（omp 的 add 认双引号，实测 18.12.5）。
import { useId, useState, type KeyboardEvent } from "react";
import type { BuiltinCommand } from "../../../../shared/omp-output/index.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Segmented, type Option } from "./controls.tsx";
import { InfoTip } from "./InfoTip.tsx";
import { runMcpWrite } from "./integrations-data.ts";
import type { ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

type Kind = "stdio" | "http" | "sse";
type Scope = "user" | "project";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function addCommand(
  name: string,
  scope: Scope,
  kind: Kind,
  command: string,
  args: string,
  url: string,
  token: string,
): BuiltinCommand {
  if (kind === "stdio") {
    const list = args.split(/\r?\n/).filter((line) => line.trim() !== "");
    return { kind: "mcp", op: "add", name, scope, spec: { type: "stdio", command: command.trim(), args: list } };
  }
  const trimmed = token.trim();
  return {
    kind: "mcp",
    op: "add",
    name,
    scope,
    spec: { type: "remote", transport: kind, url: url.trim(), ...(trimmed !== "" && { token: trimmed }) },
  };
}

export function McpForm({ scopeKey, onDone }: { scopeKey: ScopeKey; onDone(message: string | null): void }) {
  const t = useT();
  const uid = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("user");
  const [kind, setKind] = useState<Kind>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = NAME.test(name);
  const specOk = kind === "stdio" ? command.trim() !== "" : url.trim() !== "";
  const kinds: Option<Kind>[] = [
    { value: "stdio", label: t("integrations.mcp.kind.stdio") },
    { value: "http", label: "HTTP" },
    { value: "sse", label: "SSE" },
  ];
  const scopes: Option<Scope>[] = [
    { value: "user", label: t("integrations.scope.user") },
    { value: "project", label: t("integrations.scope.project") },
  ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 用户范围的视图里没有项目目录：只能加到用户范围。
      const target: Scope = scopeKey === "user" ? "user" : scope;
      const outcome = await runMcpWrite(addCommand(name, target, kind, command, args, url, token), scopeKey);
      if (outcome.ok) onDone(outcome.message);
      else setError(outcome.message);
    } catch (caught) {
      setError(errorDetail(caught));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); // 只关表单，不让设置页把这次 Esc 当成"退出设置"
    onDone(null);
  };

  return (
    <form
      className="st-login ig-form"
      data-testid="mcp-form"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (nameOk && specOk && !busy) void submit();
      }}
    >
      <div className="ig-field">
        <label className="ig-label" htmlFor={`${uid}-name`}>
          {t("integrations.mcp.name")}
          <InfoTip>{t("integrations.mcp.name.tip")}</InfoTip>
        </label>
        <input
          id={`${uid}-name`}
          className="st-input"
          data-mono
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={name}
          placeholder="my-server"
          data-testid="mcp-name"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {scopeKey !== "user" && (
        <div className="ig-field">
          <span className="ig-label" id={`${uid}-scope`}>
            {t("integrations.field.scope")}
          </span>
          <Segmented<Scope>
            value={scope}
            options={scopes}
            labelledBy={`${uid}-scope`}
            onChange={setScope}
            testId="mcp-scope"
          />
        </div>
      )}
      <div className="ig-field">
        <span className="ig-label" id={`${uid}-kind`}>
          {t("integrations.mcp.kind")}
        </span>
        <Segmented<Kind> value={kind} options={kinds} labelledBy={`${uid}-kind`} onChange={setKind} testId="mcp-kind" />
      </div>
      {kind === "stdio" ? (
        <>
          <div className="ig-field">
            <label className="ig-label" htmlFor={`${uid}-cmd`}>
              {t("integrations.mcp.command")}
            </label>
            <input
              id={`${uid}-cmd`}
              className="st-input"
              data-mono
              autoComplete="off"
              spellCheck={false}
              value={command}
              placeholder="npx"
              data-testid="mcp-command"
              onChange={(event) => setCommand(event.target.value)}
            />
          </div>
          <div className="ig-field">
            <label className="ig-label" htmlFor={`${uid}-args`}>
              {t("integrations.mcp.args")}
              <InfoTip>{t("integrations.mcp.args.tip")}</InfoTip>
            </label>
            <textarea
              id={`${uid}-args`}
              className="st-input ig-textarea"
              data-mono
              spellCheck={false}
              rows={3}
              value={args}
              placeholder={"-y\n@scope/server"}
              data-testid="mcp-args"
              onChange={(event) => setArgs(event.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="ig-field">
            <label className="ig-label" htmlFor={`${uid}-url`}>
              URL
            </label>
            <input
              id={`${uid}-url`}
              className="st-input"
              data-mono
              autoComplete="off"
              spellCheck={false}
              value={url}
              placeholder="https://example.com/mcp"
              data-testid="mcp-url"
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="ig-field">
            <label className="ig-label" htmlFor={`${uid}-token`}>
              {t("integrations.mcp.token")}
              <InfoTip>{t("integrations.mcp.token.tip")}</InfoTip>
            </label>
            <input
              id={`${uid}-token`}
              className="st-input"
              data-mono
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              data-testid="mcp-token"
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
        </>
      )}
      {error !== null && (
        <div className="st-error-text ig-raw" role="alert" data-testid="mcp-form-error">
          {error}
        </div>
      )}
      <div className="st-login-actions">
        <Button
          variant="primary"
          disabled={!nameOk || !specOk}
          loading={busy}
          onClick={() => void submit()}
          testId="mcp-save"
        >
          {t("integrations.add")}
        </Button>
        <Button variant="text" onClick={() => onDone(null)} testId="mcp-cancel">
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
