// 仪表行最右边两项，各自一个浮层：
// - 额度：当前模型的 provider 有订阅额度时显示用得最多的那个窗口（"5 Hour 12%"），否则只写"额度"；点开是各订阅账号的额度条（当前 provider 排最前）。
// - 每日用量：点开是最近几周的每日用量热力图。两个浮层底部都能去设置 → 用量看全年。
// 数据和设置页共用 usage-store（omp usage --json / stats.db）；额度在一轮之后会变，过期了才重读，不每轮都打 provider。
import { useEffect, useId, useState } from "react";
import type { QuotaAccount, QuotaLimit } from "../../../../shared/ipc.ts";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { useT } from "../../i18n/use-t.ts";
import { showView, useOmpStatus } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { loadHeatmap, loadQuota, loadQuotaIfStale, useUsageHeatmap, useUsageQuota } from "../settings/usage-store.ts";
import { HeatmapView, MetricSwitch, QuotaBlock, UntouchedRow, type Metric } from "../settings/usage-views.tsx";
import { Popover } from "./Popover.tsx";

const quotaMaxAgeMs = 2 * 60_000;
/** 浮层内宽约 330px，一周一列 13px，扣掉星期标签：22 周正好铺满。 */
const heatmapWeeks = 22;

/** 当前 provider 用得最多的窗口；provider 没给比例的窗口不参与。 */
export function busiestLimit(accounts: readonly QuotaAccount[], provider: string | null): QuotaLimit | null {
  let best: QuotaLimit | null = null;
  for (const account of accounts) {
    if (account.provider !== provider) continue;
    for (const limit of account.limits) {
      if (limit.usedFraction === null) continue;
      if (best === null || limit.usedFraction > (best.usedFraction ?? 0)) best = limit;
    }
  }
  return best;
}

function OpenSettings({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="gate-btn qm-more"
      onClick={() => {
        onClose();
        showView("settings", { section: "usage" });
      }}
    >
      {t("composer.quota.openSettings")}
    </button>
  );
}

/** provider：当前模型的 provider（草稿里是默认模型的）；refreshKey 变了就看看额度是否过期（任务每次更新时）。 */
export function QuotaMeter({ provider, refreshKey }: { provider: string | null; refreshKey?: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ready = useOmpStatus()?.state === "ready";
  const quota = useUsageQuota();

  useEffect(() => {
    if (ready) loadQuotaIfStale(quotaMaxAgeMs);
  }, [ready, refreshKey]);

  const accounts = [...(quota.data?.accounts ?? [])].sort(
    (a, b) => Number(b.provider === provider) - Number(a.provider === provider),
  );
  const limit = busiestLimit(accounts, provider);
  const percent = limit === null ? null : Math.round((limit.usedFraction ?? 0) * 100);
  const label =
    limit !== null && percent !== null
      ? t("composer.quota.item", { window: limit.windowLabel ?? limit.label, p: percent })
      : t("composer.quota.label");
  const close = () => setOpen(false);

  return (
    <div className="pop-anchor">
      <button
        type="button"
        className="usage-item usage-quota"
        data-testid="quota-meter"
        data-high={(limit?.usedFraction ?? 0) >= 0.9 || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label}\n${t("composer.quota.title")}`}
        onClick={() => {
          if (!open) void loadQuota();
          setOpen(!open);
        }}
      >
        {/* 窗口名在没有 windowLabel 时退回 provider 给的长名字，超长就省略，全文在悬停提示里。 */}
        <span className="usage-quota-text">{label}</span>
      </button>
      <Popover open={open} onClose={close} width={360} label={t("composer.quota.title")}>
        <div className="qm" data-testid="quota-popover">
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
          <OpenSettings onClose={close} />
        </div>
      </Popover>
    </div>
  );
}

export function DailyUsageMeter() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const heatmap = useUsageHeatmap();
  const [metric, setMetric] = useState<Metric>("tokens");
  const titleId = useId();
  const close = () => setOpen(false);

  return (
    <div className="pop-anchor">
      <button
        type="button"
        className="usage-item"
        data-testid="heatmap-meter"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open && heatmap.data === null && !heatmap.busy) void loadHeatmap();
          setOpen(!open);
        }}
      >
        {t("composer.quota.daily")}
      </button>
      <Popover open={open} onClose={close} width={360} align="end" label={t("composer.quota.daily")}>
        <div className="qm" data-testid="heatmap-popover">
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
          <OpenSettings onClose={close} />
        </div>
      </Popover>
    </div>
  );
}
