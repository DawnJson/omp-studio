// 添加 MCP 服务器的对话框：stdio（命令 + 每行一个参数）、http、sse（URL + 可选 token）。
// 参数一行一个，避免在界面里再做一遍"切词"：含空格的参数主进程拼命令时加引号（omp 的 add 认双引号，实测 18.12.5）。
import { useId, useState } from "react";
import type { BuiltinCommand } from "../../../../shared/omp-output/index.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, TextField, Textarea, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Reserve } from "../../ui/Reserve.tsx";
import { runMcpWrite } from "./integrations-data.ts";
import type { ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

type Kind = "stdio" | "http" | "sse";
type Scope = "user" | "project";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// 占位副本的 onChange：不会被触发（整块 inert），只为满足受控组件的类型。
const noop = () => undefined;

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

  // live=false 是占位用的副本：不带 id / testId / 值，免得和真正显示的那份重名
  const stdioFields = (live: boolean) => (
    <>
      <FormField label={t("integrations.mcp.command")} htmlFor={live ? `${uid}-cmd` : undefined}>
        <TextField
          id={live ? `${uid}-cmd` : undefined}
          mono
          width="100%"
          autoComplete="off"
          value={live ? command : ""}
          placeholder="npx"
          testId={live ? "mcp-command" : undefined}
          onChange={live ? setCommand : noop}
        />
      </FormField>
      <FormField
        label={t("integrations.mcp.args")}
        htmlFor={live ? `${uid}-args` : undefined}
        help={t("integrations.mcp.args.tip")}
      >
        <Textarea
          id={live ? `${uid}-args` : undefined}
          mono
          rows={3}
          value={live ? args : ""}
          placeholder={"-y\n@scope/server"}
          testId={live ? "mcp-args" : undefined}
          onChange={live ? setArgs : noop}
        />
      </FormField>
    </>
  );
  const remoteFields = (live: boolean) => (
    <>
      <FormField label="URL" htmlFor={live ? `${uid}-url` : undefined}>
        <TextField
          id={live ? `${uid}-url` : undefined}
          mono
          width="100%"
          autoComplete="off"
          value={live ? url : ""}
          placeholder="https://example.com/mcp"
          testId={live ? "mcp-url" : undefined}
          onChange={live ? setUrl : noop}
        />
      </FormField>
      <FormField
        label={t("integrations.mcp.token")}
        htmlFor={live ? `${uid}-token` : undefined}
        help={t("integrations.mcp.token.tip")}
      >
        <TextField
          id={live ? `${uid}-token` : undefined}
          mono
          width="100%"
          type="password"
          autoComplete="off"
          value={live ? token : ""}
          testId={live ? "mcp-token" : undefined}
          onChange={live ? setToken : noop}
        />
      </FormField>
    </>
  );

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
        {/* 传输方式不同、字段不同：两组叠在一格里占位，切换时对话框大小不变 */}
        <Reserve className="ig-reserve" ghosts={[kind === "stdio" ? remoteFields(false) : stdioFields(false)]}>
          {kind === "stdio" ? stdioFields(true) : remoteFields(true)}
        </Reserve>
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
