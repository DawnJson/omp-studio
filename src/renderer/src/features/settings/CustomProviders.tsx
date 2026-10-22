// 设置 → 提供商与账号 → 自定义提供商：models.yml 里 providers.* 的列表，添加/编辑/删除（删除先确认）。
// 编辑的是 omp 自己的配置文件（src/main/omp-config/models-file.ts），终端版 omp 同样用它。
import { useEffect, useState } from "react";
import type { CustomProviderInfo } from "../../../../shared/custom-models.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, Card } from "./controls.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { customErrorText, CustomProviderForm } from "./CustomProviderForm.tsx";
import { loadCustomProviders, reloadAfterChange, useCustomProviderLoad } from "./custom-models-store.ts";
import "./custom-providers.css";

type Editing = { kind: "add" } | { kind: "edit"; id: string } | null;

export function CustomProviders() {
  const t = useT();
  const load = useCustomProviderLoad();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<CustomProviderInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void loadCustomProviders(), []);

  const data = load.kind === "ready" ? load.data : null;
  // 后台刷新失败（比如文件在终端里被改坏了）时不假装还是上次的内容：显示错误，也不让添加。
  const loadError = load.kind === "error" ? load.error : load.kind === "ready" ? load.refreshError : null;

  const keyText = (provider: CustomProviderInfo): string => {
    switch (provider.key.kind) {
      case "none":
        return t("custom.key.none");
      case "literal":
        return t("custom.key.literal");
      case "env":
        return t("custom.key.env", { name: provider.key.name });
      case "command":
        return t("custom.key.command");
    }
  };

  const saved = () => {
    setEditing(null);
    reloadAfterChange();
    pushToast({ message: t("custom.saved") });
  };

  const confirmDelete = async (provider: CustomProviderInfo) => {
    setDeleting(null);
    setBusy(true);
    try {
      const outcome = await window.studio.deleteCustomProvider(provider.id);
      if (outcome.ok) {
        reloadAfterChange();
        pushToast({ message: t("custom.deleted") });
      } else {
        pushToast({ level: "error", message: customErrorText(t, `err.${outcome.code}`) });
        void loadCustomProviders(true);
      }
    } catch (error) {
      reportError(t, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 className="settings-group-title">{t("custom.title")}</h3>
      <Card testId="custom-providers">
        {loadError !== null && (
          <div className="st-block st-error-text" role="alert" data-testid="custom-load-failed">
            {t("custom.loadFailed", { message: describeError(t, loadError) })}
          </div>
        )}
        {(load.kind === "idle" || load.kind === "loading") && (
          <div className="st-block st-muted">{t("custom.loading")}</div>
        )}
        {data?.providers.length === 0 && editing?.kind !== "add" && (
          <div className="st-block st-muted" data-testid="custom-empty">
            {t("custom.empty")}
          </div>
        )}
        {data?.providers.map((provider) => (
          <div className="st-block" key={provider.id} data-testid={`custom-provider-${provider.id}`}>
            <div className="st-provider-head">
              <div className="cp-name">
                <div className="cp-title st-ellipsis" title={provider.id}>
                  {provider.id}
                </div>
                <div className="st-muted st-ellipsis" title={provider.baseUrl ?? ""}>
                  {provider.baseUrl}
                </div>
              </div>
              <div className="cp-status">
                {provider.models.length > 0
                  ? t("custom.models", { count: provider.models.length })
                  : provider.discovery
                    ? t("custom.discovery")
                    : t("custom.models", { count: 0 })}
                {" · "}
                {keyText(provider)}
              </div>
              <div className="st-provider-actions">
                <Button
                  disabled={busy || editing !== null}
                  onClick={() => setEditing({ kind: "edit", id: provider.id })}
                  testId={`custom-edit-${provider.id}`}
                >
                  {t("custom.edit")}
                </Button>
                <Button
                  variant="text"
                  disabled={busy || editing !== null}
                  onClick={() => setDeleting(provider)}
                  testId={`custom-delete-${provider.id}`}
                >
                  {t("custom.delete")}
                </Button>
              </div>
            </div>
            {editing?.kind === "edit" && editing.id === provider.id && (
              <CustomProviderForm mode="edit" provider={provider} onSaved={saved} onCancel={() => setEditing(null)} />
            )}
          </div>
        ))}
        {editing?.kind === "add" && (
          <div className="st-block">
            <CustomProviderForm mode="add" onSaved={saved} onCancel={() => setEditing(null)} />
          </div>
        )}
        <div className="st-block cp-footer">
          <Button
            variant="primary"
            disabled={busy || editing !== null || data === null || loadError !== null}
            onClick={() => setEditing({ kind: "add" })}
            testId="custom-add"
          >
            {t("custom.add")}
          </Button>
          <Button
            variant="text"
            onClick={() => void window.studio.revealModelsFile().catch((e: unknown) => reportError(t, e))}
          >
            {t("custom.reveal")}
          </Button>
        </div>
      </Card>
      {deleting !== null && (
        <ConfirmDialog
          title={t("custom.delete.title", { id: deleting.id })}
          body={t("custom.delete.body")}
          confirmLabel={t("custom.delete.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
