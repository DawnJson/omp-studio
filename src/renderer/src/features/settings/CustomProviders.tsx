// 设置 → 提供商与账号 → 自定义提供商：models.yml 里 providers.* 的列表，添加 / 编辑在对话框里，删除在 ⋯ 里（先确认）。
// 编辑的是 omp 自己的配置文件（src/main/omp-config/models-file.ts），终端版 omp 同样用它。
// 没有模型也没有 discovery 的条目只是覆盖 omp 内置的同名 provider（比如 `anthropic` 下只有 `modelOverrides`）：
// 编辑表单存不了它（要 baseUrl 和模型），"编辑"打开 ProviderOverrideDialog，只改 `apiKey` 和各模型的覆盖项。
import { useEffect } from "react";
import type { CustomProviderInfo } from "../../../../shared/custom-models.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { describeError, reportError } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { ProviderLogo } from "./ProviderLogo.tsx";
import { Badge, Button, ListRow, Notice, SectionHead } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { customErrorText, CustomProviderForm } from "./CustomProviderForm.tsx";
import { ProviderOverrideDialog } from "./ProviderOverrideDialog.tsx";
import {
  loadCustomProviders,
  reloadAfterChange,
  setFetchFailure,
  useCustomProviderLoad,
  useFetchFailures,
  type FetchFailure,
} from "./custom-models-store.ts";
import { RowMenu } from "./RowMenu.tsx";
import { useAsyncAction } from "./use-async-action.ts";
import "./custom-providers.css";

type Editing = { kind: "add" } | { kind: "edit"; id: string } | { kind: "override"; id: string };

const overridesBuiltin = (provider: CustomProviderInfo): boolean => provider.models.length === 0 && !provider.discovery;

/** 卡片元信息行开头的拉取失败徽标：key 被拒、地址不通，其余笼统写拉取失败；完整原因在悬停里。 */
const fetchBadgeKey = (failure: FetchFailure) =>
  failure.code === "unauthorized" || failure.code === "invalid-key"
    ? "custom.fetchBadge.key"
    : failure.code === "network" ||
        failure.code === "timeout" ||
        failure.code === "not-found" ||
        failure.code === "invalid-url"
      ? "custom.fetchBadge.url"
      : "custom.fetchBadge.other";

export function CustomProviders() {
  const t = useT();
  const load = useCustomProviderLoad();
  const fetchFailures = useFetchFailures();
  const { slot: editing, open: openEditing, closed: editingClosed, reset: resetEditing } = useDialogSlot<Editing>();
  // 确认框用 slot：上一个还在放退出动画时再点删除也能立刻开新的（旧的迟到的关闭通知按 key 对不上）。
  const { slot: deleting, open: openDeleting, closed: deletingClosed } = useDialogSlot<CustomProviderInfo>();
  const { busy, run } = useAsyncAction((error) => reportError(t, error));
  const { busy: refreshing, run: runRefresh } = useAsyncAction((error) =>
    pushToast({ level: "error", message: t("custom.refreshFailed", { message: describeError(t, error) }) }),
  );

  useEffect(() => void loadCustomProviders(), []);

  const data = load.kind === "ready" ? load.data : null;
  // 后台刷新失败（比如文件在终端里被改坏了）时不假装还是上次的内容：显示错误，也不让添加。
  const loadError = load.kind === "error" ? load.error : load.kind === "ready" ? load.refreshError : null;

  const keyText = (provider: CustomProviderInfo): string => {
    switch (provider.key.kind) {
      case "none":
        return overridesBuiltin(provider) ? t("custom.key.unset") : t("custom.key.none");
      case "literal":
        return t("custom.key.literal");
      case "env":
        // 变量设在哪：agent 目录的 `.env` / 系统环境变量 / 都没有（omp 会把变量名本身当 key 发出去）。
        return t(`custom.key.env.${provider.key.source}`, { name: provider.key.name });
      case "command":
        return t("custom.key.command");
    }
  };

  const metaText = (provider: CustomProviderInfo): string =>
    [
      provider.api,
      overridesBuiltin(provider)
        ? [
            t("custom.override"),
            provider.overrides.length > 0 ? t("custom.models", { count: provider.overrides.length }) : "",
          ]
            .filter((part) => part !== "")
            .join(" · ")
        : provider.models.length > 0 || !provider.discovery
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

  /** `omp models refresh`：重新拉各 provider 的目录（自动发现的模型也在内），主进程关掉服务进程后，这里重读模型列表。 */
  const refreshModels = () =>
    runRefresh(async () => {
      await window.studio.refreshModels();
      reloadAfterChange();
    });

  const confirmDelete = (key: number, provider: CustomProviderInfo) => {
    deletingClosed(key);
    return run(async () => {
      const outcome = await window.studio.deleteCustomProvider(provider.id);
      if (outcome.ok) {
        setFetchFailure(provider.id, null);
        reloadAfterChange();
      } else {
        pushToast({ level: "error", message: customErrorText(t, `err.${outcome.code}`) });
        void loadCustomProviders(true);
      }
    });
  };

  const target = editing?.value ?? null;
  const editingProvider =
    target !== null && target.kind !== "add"
      ? (data?.providers.find((provider) => provider.id === target.id) ?? null)
      : null;

  return (
    <div className="st-section" data-testid="custom-providers">
      <SectionHead
        title={t("custom.title")}
        count={data?.providers.length}
        actions={
          <>
            <Button
              size="sm"
              variant="quiet"
              loading={refreshing}
              disabled={busy || data === null}
              onClick={() => void refreshModels()}
              testId="custom-refresh"
            >
              {t("custom.refresh")}
            </Button>
            {/* 两个"打开文件"收进 ⋯：标题行只留一个文字按钮和一个主动作（2026-10-29 审计 SET-26） */}
            <RowMenu
              label={t("custom.more")}
              testId="custom-files"
              items={[
                {
                  id: "open-env",
                  label: t("custom.openEnv"),
                  onSelect: () => void window.studio.openEnvFile().catch((e: unknown) => reportError(t, e)),
                  testId: "custom-open-env",
                },
                {
                  id: "open-models",
                  label: t("custom.open"),
                  onSelect: () => void window.studio.openModelsFile().catch((e: unknown) => reportError(t, e)),
                  testId: "custom-open",
                },
              ]}
            />
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
      {data !== null && data.providers.length > 0 && (
        <div className="ui-cards">
          {data.providers.map((provider) => {
            const override = overridesBuiltin(provider);
            const failure = fetchFailures.get(provider.id);
            return (
              <ListRow
                key={provider.id}
                testId={`custom-provider-${provider.id}`}
                icon={<ProviderLogo id={provider.id} name={provider.id} />}
                title={provider.id}
                badges={
                  <>
                    {failure !== undefined && (
                      <Badge
                        tone="error"
                        title={customErrorText(t, `fetchErr.${failure.code}`, failure.status)}
                        testId={`custom-fetch-failed-${provider.id}`}
                      >
                        {t(fetchBadgeKey(failure))}
                      </Badge>
                    )}
                    {provider.oauthShaping && !override && (
                      <Badge
                        tone="warning"
                        title={t("custom.oauthShaping.hint")}
                        testId={`custom-oauth-shaping-${provider.id}`}
                      >
                        {t("custom.oauthShaping.badge")}
                      </Badge>
                    )}
                  </>
                }
                meta={metaText(provider)}
                actions={
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => openEditing({ kind: override ? "override" : "edit", id: provider.id })}
                      testId={`custom-edit-${provider.id}`}
                    >
                      {t("custom.edit")}
                    </Button>
                    <RowMenu
                      label={t("custom.more")}
                      disabled={busy}
                      menuOnly
                      testId={`custom-more-${provider.id}`}
                      items={[
                        {
                          id: "delete",
                          label: t("custom.delete"),
                          tone: "danger",
                          testId: `custom-delete-${provider.id}`,
                          onSelect: () => openDeleting(provider),
                        },
                      ]}
                    />
                  </>
                }
              />
            );
          })}
        </div>
      )}
      {editing?.value.kind === "add" && (
        <CustomProviderForm key={editing.key} mode="add" onSaved={saved} onClose={() => editingClosed(editing.key)} />
      )}
      {editing !== null && editingProvider !== null && editing.value.kind === "edit" && (
        <CustomProviderForm
          key={editing.key}
          mode="edit"
          provider={editingProvider}
          onSaved={saved}
          onClose={() => editingClosed(editing.key)}
        />
      )}
      {editing !== null && editingProvider !== null && editing.value.kind === "override" && (
        <ProviderOverrideDialog
          key={editing.key}
          provider={editingProvider}
          onSaved={saved}
          onClose={() => editingClosed(editing.key)}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          key={deleting.key}
          danger
          title={t("custom.delete.title", { id: deleting.value.id })}
          body={t("custom.delete.body")}
          confirmLabel={t("custom.delete.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void confirmDelete(deleting.key, deleting.value)}
          onCancel={() => deletingClosed(deleting.key)}
        />
      )}
    </div>
  );
}
