// 添加 SSH 主机的表单：名称、主机、用户、端口、密钥路径、说明、兼容模式、范围。校验和报错都以 omp 的话为准（`omp ssh add` 的原文）。
import { useId, useState, type KeyboardEvent } from "react";
import type { SshHostInput } from "../../../../shared/omp-output/ssh.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Segmented, Switch, type Option } from "./controls.tsx";
import { InfoTip } from "./InfoTip.tsx";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

type Scope = "user" | "project";

function Field({
  id,
  label,
  tip,
  value,
  onChange,
  placeholder,
  testId,
  autoFocus = false,
}: {
  id: string;
  label: string;
  tip?: string;
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  testId: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="ig-field">
      <label className="ig-label" htmlFor={id}>
        {label}
        {tip !== undefined && <InfoTip>{tip}</InfoTip>}
      </label>
      <input
        id={id}
        className="st-input"
        data-mono
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function SshForm({ scopeKey, onDone }: { scopeKey: ScopeKey; onDone(message: string | null): void }) {
  const t = useT();
  const uid = useId();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [port, setPort] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [description, setDescription] = useState("");
  const [compat, setCompat] = useState(false);
  const [scope, setScope] = useState<Scope>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portNumber = port.trim() === "" ? undefined : Number(port);
  const portOk = portNumber === undefined || (Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535);
  const canSave = name.trim() !== "" && host.trim() !== "" && portOk;
  const scopes: Option<Scope>[] = [
    { value: "user", label: t("integrations.scope.user") },
    { value: "project", label: t("integrations.scope.project") },
  ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const target: Scope = scopeKey === "user" ? "user" : scope;
    const input: SshHostInput = {
      name: name.trim(),
      host: host.trim(),
      ...(username.trim() !== "" && { username: username.trim() }),
      ...(portNumber !== undefined && { port: portNumber }),
      ...(keyPath.trim() !== "" && { keyPath: keyPath.trim() }),
      ...(description.trim() !== "" && { description: description.trim() }),
      compat,
      scope: target,
    };
    try {
      const result = await window.studio.addSshHost(input, scopeProject(scopeKey));
      onDone(result.text);
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
      data-testid="ssh-form"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !busy) void submit();
      }}
    >
      <Field
        id={`${uid}-name`}
        label={t("integrations.ssh.name")}
        value={name}
        onChange={setName}
        placeholder="my-box"
        testId="ssh-name"
        autoFocus
      />
      <Field
        id={`${uid}-host`}
        label={t("integrations.ssh.host")}
        value={host}
        onChange={setHost}
        placeholder="192.168.1.10"
        testId="ssh-host"
      />
      <Field
        id={`${uid}-user`}
        label={t("integrations.ssh.user")}
        value={username}
        onChange={setUsername}
        testId="ssh-user"
      />
      <Field
        id={`${uid}-port`}
        label={t("integrations.ssh.port")}
        value={port}
        onChange={setPort}
        placeholder="22"
        testId="ssh-port"
      />
      <Field
        id={`${uid}-key`}
        label={t("integrations.ssh.key")}
        tip={t("integrations.ssh.key.tip")}
        value={keyPath}
        onChange={setKeyPath}
        testId="ssh-key"
      />
      <Field
        id={`${uid}-desc`}
        label={t("integrations.ssh.desc")}
        value={description}
        onChange={setDescription}
        testId="ssh-desc"
      />
      <div className="ig-field">
        <span className="ig-label" id={`${uid}-compat`}>
          {t("integrations.ssh.compat")}
          <InfoTip>{t("integrations.ssh.compat.tip")}</InfoTip>
        </span>
        <Switch checked={compat} labelledBy={`${uid}-compat`} onChange={setCompat} testId="ssh-compat" />
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
            testId="ssh-scope"
          />
        </div>
      )}
      {error !== null && (
        <div className="st-error-text ig-raw" role="alert" data-testid="ssh-form-error">
          {error}
        </div>
      )}
      <div className="st-login-actions">
        <Button variant="primary" disabled={!canSave} loading={busy} onClick={() => void submit()} testId="ssh-save">
          {t("integrations.add")}
        </Button>
        <Button variant="text" onClick={() => onDone(null)} testId="ssh-cancel">
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
