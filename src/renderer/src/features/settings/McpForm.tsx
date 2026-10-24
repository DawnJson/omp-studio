// 添加 / 编辑 MCP 服务器的对话框：stdio（命令 + 每行一个参数）、http、sse（URL + 可选 token）。
// 添加走 omp 的 `/mcp add`：参数一行一个，避免在界面里再做一遍"切词"：含空格的参数主进程拼命令时加引号（omp 的 add 认双引号，实测 18.12.5）。
// 编辑直接改 omp 的 mcp.json 里这一项（主进程 src/main/integrations/mcp-file.ts）：名字和范围只读，传输方式 stdio 不能和远程互换（http ↔ sse 可以），
// token 的现有值不回传：保持不变 / 改成… / 去掉。
import { useId, useState } from "react";
import type { BuiltinCommand } from "../../../../shared/omp-output/index.ts";
import type { McpEditErrorCode, McpEditInput, McpServerFile } from "../../../../shared/mcp-edit.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, TextField, Textarea, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Reserve } from "../../ui/Reserve.tsx";
import { KeyFields } from "./CustomProviderForm.tsx";
import { mcpResource, runMcpWrite } from "./integrations-data.ts";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

type Kind = "stdio" | "http" | "sse";
type Scope = "user" | "project";
/** 编辑时 token 的处理：保持不变 / 改成新值（或原来没有时新设）/ 去掉。 */
type TokenMode = "keep" | "literal" | "none";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// 占位副本的 onChange：不会被触发（整块 inert），只为满足受控组件的类型。
const noop = () => undefined;

const argLines = (args: string): string[] => args.split(/\r?\n/).filter((line) => line.trim() !== "");

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
    return {
      kind: "mcp",
      op: "add",
      name,
      scope,
      spec: { type: "stdio", command: command.trim(), args: argLines(args) },
    };
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

export function McpForm({
  scopeKey,
  edit,
  onDone,
}: {
  scopeKey: ScopeKey;
  /** 给了就是编辑这一项（初值来自文件）；没给是添加。 */
  edit?: McpServerFile | undefined;
  onDone(message: string | null): void;
}) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(edit?.name ?? "");
  const [scope, setScope] = useState<Scope>(edit?.scope ?? "user");
  const [kind, setKind] = useState<Kind>(edit?.transport ?? "stdio");
  const [command, setCommand] = useState(edit?.command ?? "");
  const [args, setArgs] = useState(edit?.args.join("\n") ?? "");
  const [url, setUrl] = useState(edit?.url ?? "");
  const [token, setToken] = useState("");
  const [tokenMode, setTokenMode] = useState<TokenMode>(edit?.token === "set" ? "keep" : "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = edit !== undefined || NAME.test(name);
  const specOk = kind === "stdio" ? command.trim() !== "" : url.trim() !== "";
  const tokenOk = tokenMode !== "literal" || token.trim() !== "";
  const canSave = nameOk && specOk && (edit === undefined || tokenOk);
  const kinds: Option<Kind>[] = [
    { value: "stdio", label: t("integrations.mcp.kind.stdio") },
    { value: "http", label: "HTTP" },
    { value: "sse", label: "SSE" },
  ];
  const scopes: Option<Scope>[] = [
    { value: "user", label: t("integrations.scope.user") },
    { value: "project", label: t("integrations.scope.project") },
  ];
  const tokenOptions: Option<TokenMode>[] =
    edit?.token === "set"
      ? [
          { value: "keep", label: t("integrations.mcp.token.keep") },
          { value: "literal", label: t("integrations.mcp.token.set") },
          { value: "none", label: t("integrations.mcp.token.remove") },
        ]
      : [
          { value: "none", label: t("integrations.mcp.token.none") },
          { value: "literal", label: t("integrations.mcp.token.add") },
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
  const tokenField = (live: boolean) =>
    edit !== undefined ? (
      <FormField label={t("integrations.mcp.token")}>
        <Segmented<TokenMode>
          value={live ? tokenMode : "none"}
          options={tokenOptions}
          label={t("integrations.mcp.token")}
          onChange={live ? setTokenMode : noop}
          testId={live ? "mcp-token-mode" : undefined}
        />
        <KeyFields
          mode={live ? tokenMode : "none"}
          modes={["literal"]}
          text={live ? token : ""}
          onText={live ? setToken : noop}
          envValue=""
          onEnvValue={noop}
          source={null}
          testId="mcp-token"
          literalLabel={t("integrations.mcp.token")}
          literalTip={t("integrations.mcp.token.tip")}
        />
      </FormField>
    ) : (
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
      {tokenField(live)}
    </>
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (edit !== undefined) {
        const input: McpEditInput = {
          name: edit.name,
          scope: edit.scope,
          transport: kind,
          command: command.trim(),
          args: argLines(args),
          url: url.trim(),
          token: tokenMode === "literal" ? { kind: "set", value: token.trim() } : { kind: tokenMode },
        };
        const outcome = await window.studio.saveMcpServerFile(input, scopeProject(scopeKey));
        if (outcome.ok) {
          await mcpResource.load(scopeKey);
          onDone(t("integrations.mcp.edit.saved", { name: edit.name }));
        } else setError(t(`integrations.mcp.err.${outcome.code}` satisfies `integrations.mcp.err.${McpEditErrorCode}`));
        return;
      }
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
      title={
        edit === undefined ? t("integrations.mcp.form.title") : t("integrations.mcp.edit.title", { name: edit.name })
      }
      testId="mcp-form"
      footer={
        <>
          <Button onClick={() => setOpen(false)} testId="mcp-cancel">
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!canSave} loading={busy} onClick={() => void submit()} testId="mcp-save">
            {edit === undefined ? t("integrations.add") : t("integrations.mcp.edit.save")}
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
        <FormField
          label={t("integrations.mcp.name")}
          htmlFor={`${uid}-name`}
          help={edit === undefined ? t("integrations.mcp.name.tip") : undefined}
        >
          <TextField
            id={`${uid}-name`}
            mono
            width="100%"
            autoComplete="off"
            data-autofocus={edit === undefined ? "" : undefined}
            value={name}
            disabled={edit !== undefined}
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
              disabled={edit !== undefined}
              onChange={setScope}
              testId="mcp-scope"
            />
          </FormField>
        )}
        {edit === undefined ? (
          <FormField label={t("integrations.mcp.kind")}>
            <Segmented<Kind>
              value={kind}
              options={kinds}
              label={t("integrations.mcp.kind")}
              onChange={setKind}
              testId="mcp-kind"
            />
          </FormField>
        ) : (
          kind !== "stdio" && (
            <FormField label={t("integrations.mcp.kind")}>
              <Segmented<Kind>
                value={kind}
                options={kinds.filter((option) => option.value !== "stdio")}
                label={t("integrations.mcp.kind")}
                onChange={setKind}
                testId="mcp-kind"
              />
            </FormField>
          )
        )}
        {/* 传输方式不同、字段不同：两组叠在一格里占位，切换时对话框大小不变（编辑时 stdio 和远程不互换，不用占位） */}
        {edit === undefined ? (
          <Reserve className="ig-reserve" ghosts={[kind === "stdio" ? remoteFields(false) : stdioFields(false)]}>
            {kind === "stdio" ? stdioFields(true) : remoteFields(true)}
          </Reserve>
        ) : kind === "stdio" ? (
          stdioFields(true)
        ) : (
          remoteFields(true)
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
