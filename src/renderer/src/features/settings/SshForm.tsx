// 添加 SSH 主机的对话框：名称、主机、用户、端口、密钥路径、说明、兼容模式、范围。校验和报错都以 omp 的话为准（`omp ssh add` 的原文）。
import { useId, useState } from "react";
import type { SshHostInput } from "../../../../shared/omp-output/ssh.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Checkbox, FormField, Notice, Segmented, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

type Scope = "user" | "project";

function Field({
  id,
  label,
  help,
  value,
  onChange,
  placeholder,
  testId,
  autoFocus = false,
}: {
  id: string;
  label: string;
  help?: string | undefined;
  value: string;
  onChange(next: string): void;
  placeholder?: string | undefined;
  testId: string;
  autoFocus?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id} help={help}>
      <TextField
        id={id}
        mono
        width="100%"
        autoComplete="off"
        data-autofocus={autoFocus ? "" : undefined}
        value={value}
        placeholder={placeholder}
        testId={testId}
        onChange={onChange}
      />
    </FormField>
  );
}

export function SshForm({ scopeKey, onDone }: { scopeKey: ScopeKey; onDone(message: string | null): void }) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(true);
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

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={() => onDone(null)}
      title={t("integrations.ssh.form.title")}
      testId="ssh-form"
      footer={
        <>
          <Button onClick={() => setOpen(false)} testId="ssh-cancel">
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!canSave} loading={busy} onClick={() => void submit()} testId="ssh-save">
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
        <div className="ig-line">
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
        </div>
        <Field
          id={`${uid}-key`}
          label={t("integrations.ssh.key")}
          help={t("integrations.ssh.key.tip")}
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
        {scopeKey !== "user" && (
          <FormField label={t("integrations.field.scope")}>
            <Segmented<Scope>
              value={scope}
              options={scopes}
              label={t("integrations.field.scope")}
              onChange={setScope}
              testId="ssh-scope"
            />
          </FormField>
        )}
        <Checkbox checked={compat} onChange={setCompat} testId="ssh-compat">
          <span>
            {t("integrations.ssh.compat")} <span className="ig-note-inline">{t("integrations.ssh.compat.tip")}</span>
          </span>
        </Checkbox>
        {error !== null && (
          <Notice tone="error" testId="ssh-form-error">
            <span className="ig-raw">{error}</span>
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
