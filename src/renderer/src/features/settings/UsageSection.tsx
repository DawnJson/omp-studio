// 设置 → 用量（只读）：汇总条 + 各订阅账号额度 + 近一年每日消耗热力图。数据来源见 docs/architecture/omp-usage.md。
import { useEffect, useId, useState } from "react";
import type { Locale, UsageHeatmap } from "../../../../shared/ipc.ts";
import { isUntouched } from "../../../../shared/ui/usage-summary.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { useNow } from "../conversation/use-now.ts";
import { Button } from "./controls.tsx";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "./usage-store.ts";
import { HeatmapView, MetricSwitch, QuotaBlock, SummaryStrip, UntouchedRow, type Metric } from "./usage-views.tsx";
import "./usage.css";

/** "20 Oct 2025 – 19 Oct 2026"：热力图覆盖的日期范围。 */
function rangeText(locale: Locale, heatmap: UsageHeatmap): string {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const parse = (text: string) => {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return `${format.format(parse(heatmap.from))} – ${format.format(parse(heatmap.to))}`;
}

export function UsageSection() {
  const t = useT();
  const locale = useLocale();
  const status = useOmpStatus();
  const ready = status?.state === "ready";
  const quota = useUsageQuota();
  const heatmap = useUsageHeatmap();
  const [metric, setMetric] = useState<Metric>("tokens");
  const activityTitle = useId();
  // 有缓存就立刻显示；每次进入后台刷新。omp 没就绪时不读。
  useEffect(() => {
    if (!ready) return;
    void loadQuota();
    void loadHeatmap();
  }, [ready]);
  const now = useNow(quota.at !== null);

  const accounts = quota.data?.accounts ?? [];
  const touched = accounts.filter((account) => !isUntouched(account));
  const untouched = accounts.filter(isUntouched);
  const providerCount = new Set(accounts.map((account) => account.provider)).size;
  const seconds = quota.at === null ? null : Math.max(0, Math.floor((now - quota.at) / 1000));
  const updated =
    seconds === null
      ? null
      : seconds < 5
        ? t("usage.updated.now")
        : seconds < 60
          ? t("usage.updated.seconds", { n: seconds })
          : seconds < 3600
            ? t("usage.updated.minutes", { n: Math.floor(seconds / 60) })
            : t("usage.updated.hours", { n: Math.floor(seconds / 3600) });
  const database = heatmap.data?.hasDatabase ? heatmap.data : null;

  return (
    <>
      <div className="uq-top">
        <span className="uq-muted" role="status">
          {updated}
        </span>
        <Button
          loading={quota.busy}
          onClick={() => {
            void loadQuota();
            void loadHeatmap();
          }}
        >
          {t("usage.quota.refresh")}
        </Button>
      </div>

      {(quota.data !== null || database !== null) && <SummaryStrip quota={quota.data} heatmap={database} />}

      <section className="uq-section">
        <div className="uq-section-head">
          <h3 className="uq-section-title">{t("usage.quota")}</h3>
          {providerCount > 0 && (
            <span className="uq-muted">{t("usage.quota.providers", { count: providerCount })}</span>
          )}
        </div>
        {quota.error !== null && (
          <div className="uq-error" role="alert">
            {t("usage.quota.failed", { message: describeError(t, quota.error) })}
          </div>
        )}
        {touched.map((account) => (
          <QuotaBlock key={`${account.provider}/${account.account ?? ""}`} account={account} />
        ))}
        {untouched.length > 0 && <UntouchedRow accounts={untouched} />}
        {quota.data && accounts.length === 0 && (
          <div className="uq-muted uq-note" data-testid="usage-quota-empty">
            {t("usage.quota.empty")}
          </div>
        )}
        {quota.data === null && quota.busy && <div className="uq-muted uq-note">{t("usage.loading")}</div>}
      </section>

      <section className="uq-section">
        <div className="uq-section-head">
          <h3 id={activityTitle} className="uq-section-title">
            {t("usage.heatmap")}
          </h3>
          {database && (
            <div className="uq-section-aside">
              <span className="uq-muted">{rangeText(locale, database)}</span>
              <MetricSwitch value={metric} onChange={setMetric} labelledBy={activityTitle} />
            </div>
          )}
        </div>
        {heatmap.error !== null && (
          <div className="uq-error" role="alert">
            {t("usage.heatmap.failed", { message: describeError(t, heatmap.error) })}
          </div>
        )}
        {database && (
          <div data-testid="usage-heatmap">
            <HeatmapView heatmap={database} metric={metric} />
          </div>
        )}
        {heatmap.data && !heatmap.data.hasDatabase && !heatmap.busy && (
          <div className="uq-muted uq-note">{t("usage.heatmap.noDatabase")}</div>
        )}
        {heatmap.busy && (
          <div className="uq-muted usage-syncing" role="status" data-testid="usage-syncing">
            {t("usage.heatmap.syncing")}
          </div>
        )}
      </section>
    </>
  );
}
