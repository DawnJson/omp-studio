// 点发送键左边的费用弹出的用量对话框（居中，盖一层遮罩）：顶上一个切换框，"订阅额度"是各订阅账号的额度（当前 provider 排最前，
// 每个窗口一行），"每日用量"是最近几周的每日用量热力图，格子按花费着色，悬停给金额和请求数；上次看的那一页下次打开还在。
// 数据和设置页共用 usage-store（omp usage --json / stats.db）：打开时额度重读，热力图还没有数据时才读。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { Close } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { usePresence, type ExitProps } from "../../ui/presence.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "../settings/usage-store.ts";
import { HeatmapView, QuotaBlock, UntouchedRow } from "../settings/usage-views.tsx";

/** 对话框内宽约 690px，一周一列 16px（格子 13 + 间距 3），扣掉星期标签：41 周正好铺满不出横向滚动条。 */
const heatmapWeeks = 41;
const focusableSelector = "button:not(:disabled), [tabindex]:not([tabindex='-1'])";

type Tab = "quota" | "daily";
const tabs: readonly Tab[] = ["quota", "daily"];
/** 本次运行里上次看的页；对话框每次打开都重新挂载，所以记在模块里。 */
let lastTab: Tab = "quota";

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
      {heatmap.data?.hasDatabase && <HeatmapView heatmap={heatmap.data} metric="cost" recentWeeks={heatmapWeeks} />}
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
  const [tab, setTabState] = useState<Tab>(lastTab);
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const setTab = (next: Tab) => {
    lastTab = next;
    setTabState(next);
  };
  useEffect(() => {
    void loadQuota();
    if (heatmap.data === null && !heatmap.busy) void loadHeatmap();
    // 只在打开（挂载）时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 焦点：打开时进选中的页签；open 变 false（退出动画开始）就还给打开前的元素，不等卸载。
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    document.getElementById(`${baseId}-${lastTab}`)?.focus();
  }, [baseId]);
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
  // ←/→ 在两页之间切换，焦点跟着走（tablist 的常规键盘行为）。
  const onTabsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length] ?? tab;
    setTab(next);
    document.getElementById(`${baseId}-${next}`)?.focus();
  };
  return createPortal(
    <div className="scrim" data-closing={closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="usage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
        data-testid="usage-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKey}
        {...exitProps}
      >
        <header className="mp-head">
          <h2 id={`${baseId}-title`} className="mp-title">
            {t("composer.usage.overview")}
          </h2>
          <button type="button" className="tool-btn" aria-label={t("common.close")} onClick={onClose}>
            <Close size={14} />
          </button>
        </header>
        <div className="qm">
          <div
            className="segments qm-tabs"
            role="tablist"
            aria-label={t("composer.usage.overview")}
            onKeyDown={onTabsKey}
          >
            {tabs.map((id) => (
              <button
                key={id}
                id={`${baseId}-${id}`}
                type="button"
                role="tab"
                className="segment"
                aria-selected={tab === id}
                aria-controls={`${baseId}-panel`}
                tabIndex={tab === id ? 0 : -1}
                data-checked={tab === id || undefined}
                data-testid={`usage-tab-${id}`}
                onClick={() => setTab(id)}
              >
                {t(id === "quota" ? "composer.quota.title" : "composer.quota.daily")}
              </button>
            ))}
          </div>
          <div
            id={`${baseId}-panel`}
            className="qm-panel"
            role="tabpanel"
            aria-labelledby={`${baseId}-${tab}`}
            data-testid={tab === "quota" ? "quota-section" : "heatmap-section"}
          >
            {tab === "quota" ? <Quota provider={provider} /> : <DailyUsage />}
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
