// 设置 → 用量（只读）：订阅账号额度总览 + 近一年每日消耗热力图。数据来源见 docs/architecture/omp-usage.md。
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { QuotaAccount, QuotaLimit, UsageDay, UsageHeatmap } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { useOmpStatus } from "../../store/index.ts";
import { describeError } from "../../ui/errors.ts";
import { Button, Card, Segmented, type Option } from "./controls.tsx";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "./usage-store.ts";
import "./usage.css";

type Metric = "tokens" | "cost" | "requests";

function QuotaBar({ limit }: { limit: QuotaLimit }) {
  const t = useT();
  const locale = useLocale();
  const fraction = limit.usedFraction;
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const reset =
    limit.resetsAt === null
      ? null
      : t("usage.quota.reset", {
          time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(limit.resetsAt),
        });
  return (
    <div className="usage-limit" data-testid="usage-limit" data-status={limit.status}>
      <div className="usage-limit-head">
        <span>{limit.label || limit.id}</span>
        <span className="st-muted">
          {limit.status === "exhausted"
            ? t("usage.quota.exhausted")
            : percent === null
              ? t("usage.quota.unknown")
              : t("usage.quota.used", { percent })}
          {reset && ` · ${reset}`}
        </span>
      </div>
      <div
        className="usage-bar"
        role="progressbar"
        aria-label={limit.label || limit.id}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== null && { "aria-valuenow": Math.min(percent, 100) })}
      >
        <div
          className="usage-bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
          data-over={(fraction ?? 0) >= 1 || undefined}
        />
      </div>
    </div>
  );
}

function QuotaCard({ account }: { account: QuotaAccount }) {
  return (
    <Card testId="usage-account">
      <div className="st-block usage-account">
        <div className="usage-account-name">
          <strong>{account.provider}</strong>
          {account.account && <span className="st-muted">{account.account}</span>}
        </div>
        {account.limits.map((limit) => (
          <QuotaBar key={limit.id} limit={limit} />
        ))}
        {account.notes.map((note) => (
          <div key={note} className="st-muted">
            {note}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 从 from 那天所在的周（周日起）开始，按列（周）× 行（星期）排满到 to。 */
function layoutDays(heatmap: UsageHeatmap): { date: string; day: UsageDay | null }[][] {
  const byDate = new Map(heatmap.days.map((day) => [day.date, day]));
  const parse = (text: string) => {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  const start = parse(heatmap.from);
  start.setDate(start.getDate() - start.getDay());
  const end = parse(heatmap.to);
  const weeks: { date: string; day: UsageDay | null }[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: { date: string; day: UsageDay | null }[] = [];
    for (let i = 0; i < 7; i++) {
      const text = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      // 窗口之外（第一周开头、今天之后）留空位，不画格子。
      week.push({ date: text, day: text >= heatmap.from && cursor <= end ? (byDate.get(text) ?? null) : null });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function metricValue(day: UsageDay, metric: Metric): number {
  return metric === "tokens" ? day.tokens : metric === "cost" ? day.costUsd : day.requests;
}

function Heatmap({ heatmap }: { heatmap: UsageHeatmap }) {
  const t = useT();
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>("tokens");
  const labelId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  // 一年的格子比卡片宽：默认停在最近的一端。
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth });
  }, [heatmap]);
  const weeks = useMemo(() => layoutDays(heatmap), [heatmap]);
  const max = Math.max(0, ...heatmap.days.map((day) => metricValue(day, metric)));
  const total = heatmap.days.reduce((sum, day) => sum + metricValue(day, metric), 0);
  const format = (value: number) =>
    metric === "cost"
      ? new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
      : new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  // 5 档：0 = 无记录；1..4 按占最大值的比例。
  const level = (day: UsageDay | null) => {
    const value = day ? metricValue(day, metric) : 0;
    return value <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
  };
  const options: Option<Metric>[] = [
    { value: "tokens", label: t("usage.heatmap.tokens") },
    { value: "cost", label: t("usage.heatmap.cost") },
    { value: "requests", label: t("usage.heatmap.requests") },
  ];
  return (
    <Card testId="usage-heatmap">
      <div className="st-block usage-heat">
        <div className="usage-heat-head">
          <span id={labelId} className="st-muted">
            {t("usage.heatmap.total", { value: format(total), days: heatmap.days.length })}
          </span>
          <Segmented<Metric>
            value={metric}
            options={options}
            labelledBy={labelId}
            onChange={(next) => setMetric(next)}
            testId="usage-metric"
          />
        </div>
        <div ref={scroller} className="usage-scroll">
          <div className="usage-grid" role="img" aria-labelledby={labelId}>
            {weeks.map((week) => (
              <div key={week[0]?.date} className="usage-week">
                {week.map(({ date, day }) => (
                  <span
                    key={date}
                    className="usage-cell"
                    data-level={level(day)}
                    data-empty={date < heatmap.from || date > heatmap.to || undefined}
                    title={t("usage.heatmap.day", {
                      date,
                      value: day ? format(metricValue(day, metric)) : t("usage.heatmap.none"),
                    })}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="usage-legend st-muted">
          {t("usage.heatmap.less")}
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className="usage-cell" data-level={n} />
          ))}
          {t("usage.heatmap.more")}
        </div>
      </div>
    </Card>
  );
}

export function UsageSection() {
  const t = useT();
  const status = useOmpStatus();
  const ready = status?.state === "ready";
  const quota = useUsageQuota();
  const heatmap = useUsageHeatmap();
  // 有缓存就立刻显示；每次进入后台刷新。omp 没就绪时不读。
  useEffect(() => {
    if (!ready) return;
    void loadQuota();
    void loadHeatmap();
  }, [ready]);

  return (
    <>
      <h3 className="settings-group-title">{t("usage.quota")}</h3>
      {quota.error !== null && (
        <div className="st-card st-block st-error-text" role="alert">
          {t("usage.quota.failed", { message: describeError(t, quota.error) })}
        </div>
      )}
      {quota.data?.accounts.map((account) => (
        <QuotaCard key={`${account.provider}/${account.account ?? ""}`} account={account} />
      ))}
      {quota.data && quota.data.accounts.length === 0 && (
        <Card>
          <div className="st-block st-muted" data-testid="usage-quota-empty">
            {t("usage.quota.empty")}
          </div>
        </Card>
      )}
      {quota.data === null && quota.busy && <div className="st-muted">{t("usage.loading")}</div>}
      <div className="usage-actions">
        <Button loading={quota.busy} onClick={() => void loadQuota()}>
          {t("usage.quota.refresh")}
        </Button>
      </div>

      <h3 className="settings-group-title">{t("usage.heatmap")}</h3>
      {heatmap.error !== null && (
        <div className="st-card st-block st-error-text" role="alert">
          {t("usage.heatmap.failed", { message: describeError(t, heatmap.error) })}
        </div>
      )}
      {heatmap.data && heatmap.data.hasDatabase && <Heatmap heatmap={heatmap.data} />}
      {heatmap.data && !heatmap.data.hasDatabase && !heatmap.busy && (
        <Card>
          <div className="st-block st-muted">{t("usage.heatmap.noDatabase")}</div>
        </Card>
      )}
      {heatmap.busy && (
        <div className="st-muted usage-syncing" role="status" data-testid="usage-syncing">
          {t("usage.heatmap.syncing")}
        </div>
      )}
    </>
  );
}
