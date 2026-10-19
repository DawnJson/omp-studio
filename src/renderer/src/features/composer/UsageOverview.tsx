// 点发送键左边的费用弹出的用量浮层：最近几周的每日用量热力图 + 各订阅账号的额度条（当前 provider 排最前）。
// 数据和设置页共用 usage-store（omp usage --json / stats.db）：打开时额度重读，热力图还没有数据时才读。
import { useEffect, useId, useState } from "react";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "../settings/usage-store.ts";
import { HeatmapView, MetricSwitch, QuotaBlock, UntouchedRow, type Metric } from "../settings/usage-views.tsx";

/** 浮层内宽约 330px，一周一列 13px，扣掉星期标签：22 周正好铺满。 */
const heatmapWeeks = 22;

function DailyUsage() {
  const t = useT();
  const heatmap = useUsageHeatmap();
  const [metric, setMetric] = useState<Metric>("tokens");
  const titleId = useId();
  return (
    <section className="qm-section" data-testid="heatmap-section">
      <strong id={titleId} className="mb-title">
        {t("composer.quota.daily")}
      </strong>
      {heatmap.error !== null && (
        <p className="ctx-note" role="alert">
          {t("usage.heatmap.failed", { message: describeError(t, heatmap.error) })}
        </p>
      )}
      {heatmap.data?.hasDatabase && (
        <>
          <MetricSwitch value={metric} onChange={setMetric} labelledBy={titleId} />
          <HeatmapView heatmap={heatmap.data} metric={metric} recentWeeks={heatmapWeeks} />
        </>
      )}
      {heatmap.data && !heatmap.data.hasDatabase && !heatmap.busy && (
        <p className="ctx-note">{t("usage.heatmap.noDatabase")}</p>
      )}
      {heatmap.busy && <p className="ctx-note">{t("usage.heatmap.syncing")}</p>}
    </section>
  );
}

function Quota({ provider }: { provider: string | null }) {
  const t = useT();
  const quota = useUsageQuota();
  const accounts = [...(quota.data?.accounts ?? [])].sort(
    (a, b) => Number(b.provider === provider) - Number(a.provider === provider),
  );
  return (
    <section className="qm-section" data-testid="quota-section">
      <strong className="mb-title">{t("composer.quota.title")}</strong>
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
    </section>
  );
}

/** provider：当前模型的 provider（草稿里是默认模型的），它的账号排在最前。浮层打开时才挂载。 */
export function UsageOverview({ provider }: { provider: string | null }) {
  const heatmap = useUsageHeatmap();
  useEffect(() => {
    void loadQuota();
    if (heatmap.data === null && !heatmap.busy) void loadHeatmap();
    // 只在打开（挂载）时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="qm" data-testid="usage-popover">
      <DailyUsage />
      <Quota provider={provider} />
    </div>
  );
}
