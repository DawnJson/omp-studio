// 设置 → 集成 → SSH 主机（spec §4.19）：`omp ssh list|add|remove --json` 的界面。读写都经 omp 自己的命令，不直接改 ssh.json。
// 项目范围的主机在项目目录里读写（`.omp/ssh.json`）；选了项目时列表包含用户和项目两层，每行标出范围。
import { useEffect, useState } from "react";
import type { SshHost } from "../../../../shared/omp-output/ssh.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { Button, Card, SettingRow } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { sshResource } from "./integrations-data.ts";
import { scopeProject, setCardScope, useCardScope } from "./integrations-store.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import { SshForm } from "./SshForm.tsx";
import "./integrations.css";

function hostLine(host: SshHost): string {
  const login = host.username !== undefined ? `${host.username}@${host.host}` : host.host;
  return host.port !== undefined ? `${login}:${host.port}` : login;
}

export function SshCard() {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const scope = useCardScope("ssh");
  const load = sshResource.useLoad(scope);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<SshHost | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void sshResource.load(scope);
  }, [ready, scope]);

  const hosts = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  const remove = async (host: SshHost) => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await window.studio.removeSshHost(host.name, host.scope, scopeProject(scope));
      pushToast({ message: result.text });
      await sshResource.load(scope);
    } catch (error) {
      setFailure(errorDetail(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="settings-group-title">{t("integrations.ssh.title")}</h3>
      <Card testId="ssh-card">
        <SettingRow title={t("integrations.field.scope")} desc={t("integrations.ssh.scope.desc")}>
          {(labelId) => (
            <ScopePicker
              value={scope}
              includeUser
              labelledBy={labelId}
              onChange={(next) => {
                setAdding(false);
                setFailure(null);
                setCardScope("ssh", next);
              }}
              testId="ssh-scope-picker"
            />
          )}
        </SettingRow>
        {load.kind === "error" && (
          <div className="st-block st-error-text ig-raw" role="alert" data-testid="ssh-load-failed">
            {t("integrations.loadFailed", { message: errorDetail(load.error) })}
          </div>
        )}
        {!ready && <div className="st-block st-muted">{t("settings.cfg.notReady")}</div>}
        {ready && hosts === null && load.kind !== "error" && (
          <div className="st-block st-muted">{t("integrations.loading")}</div>
        )}
        {hosts?.length === 0 && !adding && (
          <div className="st-block st-muted" data-testid="ssh-empty">
            {t("integrations.ssh.empty")}
          </div>
        )}
        {hosts?.map((host) => (
          <div className="st-block" key={`${host.scope}:${host.name}`} data-testid={`ssh-row-${host.name}`}>
            <div className="st-provider-head">
              <div className="ig-name">
                <div className="ig-title st-ellipsis" title={host.name}>
                  {host.name}
                </div>
                <div className="st-muted st-mono st-ellipsis" title={hostLine(host)}>
                  {hostLine(host)}
                </div>
                {(host.keyPath !== undefined || host.description !== undefined) && (
                  <div
                    className="st-muted st-ellipsis"
                    title={[host.keyPath, host.description].filter(Boolean).join(" · ")}
                  >
                    {[host.keyPath, host.description].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="ig-meta">
                {host.scope === "user" ? t("integrations.scope.user") : t("integrations.scope.project")}
                {host.compat && ` · ${t("integrations.ssh.compat")}`}
              </div>
              <div className="st-provider-actions">
                <Button
                  variant="text"
                  disabled={busy}
                  onClick={() => setRemoving(host)}
                  testId={`ssh-remove-${host.name}`}
                >
                  {t("integrations.remove")}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {failure !== null && (
          <div className="st-block st-error-text ig-raw" role="alert" data-testid="ssh-failure">
            {failure}
          </div>
        )}
        {adding && (
          <div className="st-block">
            <SshForm
              scopeKey={scope}
              onDone={(message) => {
                setAdding(false);
                if (message !== null) {
                  pushToast({ message });
                  void sshResource.load(scope);
                }
              }}
            />
          </div>
        )}
        <div className="st-block ig-footer">
          <Button
            variant="primary"
            disabled={!ready || adding || busy}
            onClick={() => setAdding(true)}
            testId="ssh-add"
          >
            {t("integrations.ssh.add")}
          </Button>
          <Button variant="text" disabled={!ready} onClick={() => void sshResource.load(scope)} testId="ssh-refresh">
            {t("integrations.refresh")}
          </Button>
        </div>
      </Card>
      {removing !== null && (
        <ConfirmDialog
          title={t("integrations.ssh.remove.title", { name: removing.name })}
          body={t("integrations.ssh.remove.body")}
          confirmLabel={t("integrations.remove")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const host = removing;
            setRemoving(null);
            void remove(host);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
