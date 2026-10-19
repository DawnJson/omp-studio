// 点发送键左边的费用弹出的用量浮层（宽 520）：顶上一个切换框，"订阅额度"是各订阅账号的额度条（当前 provider 排最前），
// "每日用量"是最近几周的每日用量热力图，格子按花费着色，悬停给金额和请求数；上次看的那一页下次打开还在。
// 数据和设置页共用 usage-store（omp usage --json / stats.db）：打开时额度重读，热力图还没有数据时才读。
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "../settings/usage-store.ts";
import { HeatmapView, QuotaBlock, UntouchedRow } from "../settings/usage-views.tsx";

/** 浮层内宽约 490px，一周一列 16px（格子 13 + 间距 3），扣掉星期标签：28 周正好铺满。 */
const heatmapWeeks = 28;

type Tab = "quota" | "daily";
const tabs: readonly Tab[] = ["quota", "daily"];
/** 本次运行里上次看的页；浮层每次打开都重新挂载，所以记在模块里。 */
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

/** provider：当前模型的 provider（草稿里是默认模型的），它的账号排在最前。浮层打开时才挂载。 */
export function UsageOverview({ provider }: { provider: string | null }) {
  const t = useT();
  const heatmap = useUsageHeatmap();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const baseId = useId();
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
  // ←/→ 在两页之间切换，焦点跟着走（tablist 的常规键盘行为）。
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length] ?? tab;
    setTab(next);
    document.getElementById(`${baseId}-${next}`)?.focus();
  };
  return (
    <div className="qm" data-testid="usage-popover">
      <div className="segments qm-tabs" role="tablist" aria-label={t("composer.usage.overview")} onKeyDown={onKeyDown}>
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
  );
}
