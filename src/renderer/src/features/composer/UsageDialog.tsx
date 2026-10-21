// 点发送键左边的费用弹出的用量对话框（居中，盖一层遮罩，高度固定）：标题栏是"用量与额度"，下面一页滚动内容，没有页签：
// 先是各订阅账号的额度（当前 provider 排最前，每个账号一张卡，每个窗口一格），再是"每日用量"小节：最近几周的每日用量热力图，
// 格子按花费着色，悬停给金额和请求数。数据和设置页共用 usage-store（omp usage --json / stats.db）：打开时额度重读，热力图还没有数据时才读。
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { Close } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { usePresence, type ExitProps } from "../../ui/presence.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "../settings/usage-store.ts";
import { HeatmapView, QuotaBlock, UntouchedRow } from "../settings/usage-views.tsx";

// 热力图在对话框里按宽度铺满：画全部周（一年 53 周），格子大小跟着对话框内宽算，见 HeatmapView 的 fit。
const focusableSelector = "button:not(:disabled), [tabindex]:not([tabindex='-1'])";

function DailyUsage() {
  const t = useT();
  const heatmap = useUsageHeatmap();
  return (
    <>
      {heatmap.error !== null && (
        <p className="ctx-note" role="alert">
          {t("usage.heatmap.failed", { message: describeError(t, heatmap.error) })}
        </p>
      )}
      {heatmap.data?.hasDatabase && <HeatmapView heatmap={heatmap.data} metric="cost" fit />}
      {heatmap.data && !heatmap.data.hasDatabase && !heatmap.busy && (
        <p className="ctx-note">{t("usage.heatmap.noDatabase")}</p>
      )}
      {heatmap.busy && <p className="ctx-note">{t("usage.heatmap.syncing")}</p>}
    </>
  );
}

function Quota({ provider }: { provider: string | null }) {
  const t = useT();
  const quota = useUsageQuota();
  const accounts = [...(quota.data?.accounts ?? [])].sort(
    (a, b) => Number(b.provider === provider) - Number(a.provider === provider),
  );
  return (
    <>
      {quota.error !== null && (
        <p className="ctx-note" role="alert">
          {t("usage.quota.failed", { message: describeError(t, quota.error) })}
        </p>
      )}
      {quota.data === null && quota.busy && <p className="ctx-note">{t("usage.loading")}</p>}
      {quota.data !== null && accounts.length === 0 && <p className="ctx-note">{t("usage.quota.empty")}</p>}
      {accounts
        .filter((account) => !isUntouched(account))
        .map((account) => (
          <QuotaBlock key={`${account.provider}/${account.account ?? ""}`} account={account} />
        ))}
      {accounts.some(isUntouched) && <UntouchedRow accounts={accounts.filter(isUntouched)} />}
    </>
  );
}

/** 对话框本体：open 变 false 后留着放完退出动画，由外层 UsageDialog 卸载。 */
function UsageDialogBody({
  provider,
  open,
  onClose,
  closing,
  exitProps,
}: {
  provider: string | null;
  open: boolean;
  onClose: () => void;
  closing: boolean;
  exitProps: ExitProps;
}) {
  const t = useT();
  useTitleBarDim(open);
  const heatmap = useUsageHeatmap();
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void loadQuota();
    if (heatmap.data === null && !heatmap.busy) void loadHeatmap();
    // 只在打开（挂载）时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 焦点：打开时进关闭按钮；open 变 false（退出动画开始）就还给打开前的元素，不等卸载。
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [open]);
  const onDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // 消耗掉 Esc：输入框的"Esc 停止任务"在 window 上监听，不能被它连带触发。
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div className="scrim" data-closing={closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="usage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("composer.usage.overview")}
        data-testid="usage-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKey}
        {...exitProps}
      >
        <header className="mp-head">
          <h2 className="mp-title">{t("composer.usage.overview")}</h2>
          <button
            ref={closeRef}
            type="button"
            className="tool-btn usage-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <Close size={14} />
          </button>
        </header>
        <div className="qm">
          {/* 对话框高度固定（见 composer.css）：额度在上、热力图在下，同一页，内容多了在 .qm-stack 里滚动。 */}
          <div className="qm-stack">
            <section className="qm-panel" data-testid="quota-section">
              <Quota provider={provider} />
            </section>
            <section className="qm-panel" data-testid="heatmap-section" aria-labelledby={`${baseId}-daily`}>
              <h3 className="uq-section-title" id={`${baseId}-daily`}>
                {t("composer.quota.daily")}
              </h3>
              <DailyUsage />
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** provider：当前模型的 provider（草稿里是默认模型的），它的账号排在最前。 */
export function UsageDialog(props: { provider: string | null; open: boolean; onClose: () => void }) {
  const presence = usePresence(props.open);
  if (!presence.mounted) return null;
  return <UsageDialogBody {...props} closing={presence.closing} exitProps={presence.exitProps} />;
}
