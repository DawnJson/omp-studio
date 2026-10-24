// 设置 → 集成 → SSH 主机（spec §4.19）：`omp ssh list|add|remove --json` 的界面。读写都经 omp 自己的命令，不直接改 ssh.json。
// 项目范围的主机在项目目录里读写（`.omp/ssh.json`）；选了项目时列表包含用户和项目两层，每行标出范围（范围由页头的下拉选）。
import { useEffect, useState } from "react";
import type { SshHost } from "../../../../shared/omp-output/ssh.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus, Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { sshResource } from "./integrations-data.ts";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import { RowMenu } from "./RowMenu.tsx";
import { SshForm } from "./SshForm.tsx";
import "./integrations.css";

function hostLine(host: SshHost): string {
  const login = host.username !== undefined ? `${host.username}@${host.host}` : host.host;
  return host.port !== undefined ? `${login}:${host.port}` : login;
}

export function SshCard({ scope }: { scope: ScopeKey }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = sshResource.useLoad(scope);
  const { slot: adding, open: openAdding, closed: addingClosed, reset: resetAdding } = useDialogSlot();
  const [busy, setBusy] = useState(false);
  // 确认框用 slot：上一个还在放退出动画时再点删除也能立刻开新的。
  const { slot: removing, open: openRemoving, closed: removingClosed } = useDialogSlot<SshHost>();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void sshResource.load(scope);
  }, [ready, scope]);
  // 换范围：关掉添加对话框、清掉上一个范围的失败提示。
  useEffect(() => {
    resetAdding();
    setFailure(null);
  }, [scope, resetAdding]);

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
    <div className="st-section" data-testid="ssh-card">
      <SectionHead
        title={t("integrations.ssh.title")}
        count={hosts?.length}
        actions={
          <>
            <IconButton
              label={t("integrations.refresh")}
              disabled={!ready}
              onClick={() => void sshResource.load(scope)}
              testId="ssh-refresh"
            >
              <Restart />
            </IconButton>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={!ready || busy}
              onClick={() => openAdding(true)}
              testId="ssh-add"
            >
              {t("integrations.ssh.add")}
            </Button>
          </>
        }
      />
      {load.kind === "error" && (
        <Notice tone="error" testId="ssh-load-failed">
          <span className="ig-raw">{t("integrations.loadFailed", { message: errorDetail(load.error) })}</span>
        </Notice>
      )}
      {!ready && <p className="ig-note">{t("settings.cfg.notReady")}</p>}
      {ready && hosts === null && load.kind !== "error" && <p className="ig-note">{t("integrations.loading")}</p>}
      {hosts?.length === 0 && (
        <p className="ig-note" data-testid="ssh-empty">
          {t("integrations.ssh.empty")}
        </p>
      )}
      {hosts !== null && hosts.length > 0 && (
        <div className="ui-cards">
          {hosts.map((host) => (
            <ListRow
              key={`${host.scope}:${host.name}`}
              testId={`ssh-row-${host.name}`}
              icon={host.name.slice(0, 2)}
              title={host.name}
              badges={
                <>
                  <Badge>
                    {host.scope === "user" ? t("integrations.scope.user") : t("integrations.scope.project")}
                  </Badge>
                  {host.compat && <Badge>{t("integrations.ssh.compat")}</Badge>}
                </>
              }
              meta={[hostLine(host), host.keyPath, host.description].filter(Boolean).join(" · ")}
              actions={
                <RowMenu
                  label={t("integrations.more")}
                  disabled={busy}
                  testId={`ssh-more-${host.name}`}
                  items={[
                    {
                      id: "remove",
                      label: t("integrations.remove"),
                      tone: "danger",
                      testId: `ssh-remove-${host.name}`,
                      onSelect: () => openRemoving(host),
                    },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}
      {failure !== null && (
        <Notice tone="error" testId="ssh-failure">
          <span className="ig-raw">{failure}</span>
        </Notice>
      )}
      {adding !== null && (
        <SshForm
          key={adding.key}
          scopeKey={scope}
          onDone={(message) => {
            addingClosed(adding.key);
            if (message !== null) {
              pushToast({ message });
              void sshResource.load(scope);
            }
          }}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          key={removing.key}
          danger
          title={t("integrations.ssh.remove.title", { name: removing.value.name })}
          body={t("integrations.ssh.remove.body")}
          confirmLabel={t("integrations.remove")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const host = removing.value;
            removingClosed(removing.key);
            void remove(host);
          }}
          onCancel={() => removingClosed(removing.key)}
        />
      )}
    </div>
  );
}
