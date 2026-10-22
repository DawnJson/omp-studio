// 添加 MCP 服务器的对话框：stdio（命令 + 每行一个参数）、http、sse（URL + 可选 token）。
// 参数一行一个，避免在界面里再做一遍"切词"：含空格的参数主进程拼命令时加引号（omp 的 add 认双引号，实测 18.12.5）。
import { useId, useState } from "react";
import type { BuiltinCommand } from "../../../../shared/omp-output/index.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, TextField, Textarea, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
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
  const [open, setOpen] = useState(true);
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
  const canSave = nameOk && specOk;
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

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={() => onDone(null)}
      title={t("integrations.mcp.form.title")}
      testId="mcp-form"
      footer={
        <>
          <Button onClick={() => setOpen(false)} testId="mcp-cancel">
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!canSave} loading={busy} onClick={() => void submit()} testId="mcp-save">
            {t("integrations.add")}
          </Button>
        </>
      }
    >
      <form
        className="ig-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && !busy) void submit();
        }}
      >
        <FormField label={t("integrations.mcp.name")} htmlFor={`${uid}-name`} help={t("integrations.mcp.name.tip")}>
          <TextField
            id={`${uid}-name`}
            mono
            width="100%"
            autoComplete="off"
            data-autofocus=""
            value={name}
            placeholder="my-server"
            testId="mcp-name"
            onChange={setName}
          />
        </FormField>
        {scopeKey !== "user" && (
          <FormField label={t("integrations.field.scope")}>
            <Segmented<Scope>
              value={scope}
              options={scopes}
              label={t("integrations.field.scope")}
              onChange={setScope}
              testId="mcp-scope"
            />
          </FormField>
        )}
        <FormField label={t("integrations.mcp.kind")}>
          <Segmented<Kind>
            value={kind}
            options={kinds}
            label={t("integrations.mcp.kind")}
            onChange={setKind}
            testId="mcp-kind"
          />
        </FormField>
        {kind === "stdio" ? (
          <>
            <FormField label={t("integrations.mcp.command")} htmlFor={`${uid}-cmd`}>
              <TextField
                id={`${uid}-cmd`}
                mono
                width="100%"
                autoComplete="off"
                value={command}
                placeholder="npx"
                testId="mcp-command"
                onChange={setCommand}
              />
            </FormField>
            <FormField label={t("integrations.mcp.args")} htmlFor={`${uid}-args`} help={t("integrations.mcp.args.tip")}>
              <Textarea
                id={`${uid}-args`}
                mono
                rows={3}
                value={args}
                placeholder={"-y\n@scope/server"}
                testId="mcp-args"
                onChange={setArgs}
              />
            </FormField>
          </>
        ) : (
          <>
            <FormField label="URL" htmlFor={`${uid}-url`}>
              <TextField
                id={`${uid}-url`}
                mono
                width="100%"
                autoComplete="off"
                value={url}
                placeholder="https://example.com/mcp"
                testId="mcp-url"
                onChange={setUrl}
              />
            </FormField>
            <FormField
              label={t("integrations.mcp.token")}
              htmlFor={`${uid}-token`}
              help={t("integrations.mcp.token.tip")}
            >
              <TextField
                id={`${uid}-token`}
                mono
                width="100%"
                type="password"
                autoComplete="off"
                value={token}
                testId="mcp-token"
                onChange={setToken}
              />
            </FormField>
          </>
        )}
        {error !== null && (
          <Notice tone="error" testId="mcp-form-error">
            <span className="ig-raw">{error}</span>
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
