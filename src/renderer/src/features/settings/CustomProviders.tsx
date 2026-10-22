// 设置 → 提供商与账号 → 自定义提供商：models.yml 里 providers.* 的列表，添加 / 编辑在对话框里，删除在 ⋯ 里（先确认）。
// 编辑的是 omp 自己的配置文件（src/main/omp-config/models-file.ts），终端版 omp 同样用它。
import { useEffect, useState } from "react";
import type { CustomProviderInfo } from "../../../../shared/custom-models.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { Button, ListRow, Notice, SectionHead } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { customErrorText, CustomProviderForm } from "./CustomProviderForm.tsx";
import { loadCustomProviders, reloadAfterChange, useCustomProviderLoad } from "./custom-models-store.ts";
import { RowMenu } from "./RowMenu.tsx";
import "./custom-providers.css";

type Editing = { kind: "add" } | { kind: "edit"; id: string };

export function CustomProviders() {
  const t = useT();
  const load = useCustomProviderLoad();
  const { slot: editing, open: openEditing, closed: editingClosed, reset: resetEditing } = useDialogSlot<Editing>();
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

  const metaText = (provider: CustomProviderInfo): string =>
    [
      provider.api,
      provider.baseUrl,
      provider.models.length > 0 || !provider.discovery
        ? t("custom.models", { count: provider.models.length })
        : t("custom.discovery"),
      keyText(provider),
    ]
      .filter((part) => part !== null && part !== "")
      .join(" · ");

  const saved = () => {
    resetEditing();
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

  const target = editing?.value ?? null;
  const editingProvider =
    target?.kind === "edit" ? (data?.providers.find((provider) => provider.id === target.id) ?? null) : null;

  return (
    <div data-testid="custom-providers">
      <SectionHead
        title={t("custom.title")}
        count={data?.providers.length}
        actions={
          <>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void window.studio.revealModelsFile().catch((e: unknown) => reportError(t, e))}
              testId="custom-reveal"
            >
              {t("custom.reveal")}
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={busy || data === null || loadError !== null}
              onClick={() => openEditing({ kind: "add" })}
              testId="custom-add"
            >
              {t("custom.add")}
            </Button>
          </>
        }
      />
      {loadError !== null && (
        <Notice tone="error" testId="custom-load-failed">
          {t("custom.loadFailed", { message: describeError(t, loadError) })}
        </Notice>
      )}
      {(load.kind === "idle" || load.kind === "loading") && <p className="cp-text">{t("custom.loading")}</p>}
      {data?.providers.length === 0 && (
        <p className="cp-text" data-testid="custom-empty">
          {t("custom.empty")}
        </p>
      )}
      {data !== null && data.providers.length > 0 && (
        <div className="ui-rows">
          {data.providers.map((provider) => (
            <ListRow
              key={provider.id}
              testId={`custom-provider-${provider.id}`}
              icon={provider.id.slice(0, 1).toUpperCase()}
              title={provider.id}
              meta={metaText(provider)}
              actions={
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => openEditing({ kind: "edit", id: provider.id })}
                    testId={`custom-edit-${provider.id}`}
                  >
                    {t("custom.edit")}
                  </Button>
                  <RowMenu
                    label={t("custom.more")}
                    disabled={busy}
                    testId={`custom-more-${provider.id}`}
                    items={[
                      {
                        id: "delete",
                        label: t("custom.delete"),
                        tone: "danger",
                        testId: `custom-delete-${provider.id}`,
                        onSelect: () => setDeleting(provider),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
        </div>
      )}
      {editing?.value.kind === "add" && (
        <CustomProviderForm key={editing.key} mode="add" onSaved={saved} onClose={() => editingClosed(editing.key)} />
      )}
      {editing !== null && editingProvider !== null && (
        <CustomProviderForm
          key={editing.key}
          mode="edit"
          provider={editingProvider}
          onSaved={saved}
          onClose={() => editingClosed(editing.key)}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          danger
          title={t("custom.delete.title", { id: deleting.id })}
          body={t("custom.delete.body")}
          confirmLabel={t("custom.delete.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
