// 用量的视图：汇总条、账号额度块、每日消耗热力图。设置 → 用量和输入框下方的两个浮层共用。
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type {
  Locale,
  QuotaAccount,
  QuotaLimit,
  QuotaSnapshot,
  UsageDay,
  UsageHeatmap,
} from "../../../../shared/ipc.ts";
import { activityStats, leftPercent, summarizeUsage, tightestQuota } from "../../../../shared/ui/usage-summary.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { useNow } from "../sidebar/task-time.ts";
import { Segmented, type Option } from "./controls.tsx";
import "./usage.css";

export type Metric = "tokens" | "cost" | "requests";

const dayMs = 24 * 60 * 60 * 1000;

function parseDate(text: string): Date {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

function dateText(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 美元：大数不要小数，小数额保留两位。 */
function money(locale: Locale, value: number, digits = value >= 100 ? 0 : 2): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function compact(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** 重置时间：7 天内写"星期 + 时:分"，更远的写短日期。 */
function resetText(locale: Locale, resetsAt: number, now: number): string {
  return Math.abs(resetsAt - now) < 7 * dayMs
    ? new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(
        resetsAt,
      )
    : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(resetsAt);
}

/** 有的 provider 把窗口写进了名字（"Claude 5 Hour"），有的没有（"Gemini" + "Weekly"）：没写进去才补。 */
export function limitName(limit: QuotaLimit): string {
  const base = limit.label || limit.id;
  return limit.windowLabel && !base.includes(limit.windowLabel) ? `${base} · ${limit.windowLabel}` : base;
}

/** 一个额度窗口一行：名称 | 进度条（剩余） | 剩余百分比 | 重置时间。窄了名称在上、条在下。 */
export function QuotaLimitRow({ limit }: { limit: QuotaLimit }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const left = leftPercent(limit);
  const name = limitName(limit);
  const status =
    limit.status === "exhausted"
      ? t("usage.quota.exhausted")
      : left === null
        ? t("usage.quota.unknown")
        : t("usage.quota.left", { percent: left });
  const reset =
    limit.resetsAt === null ? null : t("usage.quota.resets", { time: resetText(locale, limit.resetsAt, now) });
  return (
    <div className="uq-limit" data-testid="usage-limit" data-status={limit.status}>
      <span className="uq-limit-name" title={name}>
        {name}
      </span>
      <div
        className="uq-bar"
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(left !== null && { "aria-valuenow": left })}
      >
        <div className="uq-bar-fill" style={{ width: `${left ?? 0}%` }} />
      </div>
      <span className="uq-limit-left">{status}</span>
      {reset && (
        <span className="uq-limit-reset" title={reset}>
          {reset}
        </span>
      )}
    </div>
  );
}

/** 账号里最糟的状态，决定名字前面那个点的颜色。 */
function accountStatus(account: QuotaAccount): "ok" | "warning" | "exhausted" {
  if (account.limits.some((limit) => limit.status === "exhausted")) return "exhausted";
  if (account.limits.some((limit) => limit.status === "warning" || (limit.usedFraction ?? 0) >= 0.9)) return "warning";
  return "ok";
}

/** 一个账号一块：左边状态点 + provider + 账号 + 备注，右边是各窗口的行。 */
export function QuotaBlock({ account }: { account: QuotaAccount }) {
  return (
    <section className="uq-block" data-testid="usage-account">
      <div className="uq-block-grid">
        <div className="uq-block-head">
          <div className="uq-block-name">
            <span className="uq-dot" data-status={accountStatus(account)} aria-hidden="true" />
            <strong title={account.provider}>{account.provider}</strong>
          </div>
          {account.account && (
            <span className="uq-muted" title={account.account}>
              {account.account}
            </span>
          )}
          {account.notes.map((note) => (
            <span key={note} className="uq-muted" title={note}>
              {note}
            </span>
          ))}
        </div>
        <div className="uq-limits">
          {account.limits.map((limit) => (
            <QuotaLimitRow key={limit.id} limit={limit} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** 一整天没用过的账号合成一行：只列 provider 名字。 */
export function UntouchedRow({ accounts }: { accounts: readonly QuotaAccount[] }) {
  const t = useT();
  const names = [...new Set(accounts.map((account) => account.provider))].join(", ");
  return (
    <div className="uq-untouched">
      <span className="uq-muted">{t("usage.quota.untouched")}</span>
      <span className="uq-untouched-names" title={names}>
        {names}
      </span>
    </div>
  );
}

function Stat({ label, value, sub, extra }: { label: string; value: string; sub: string; extra?: ReactNode }) {
  return (
    <div className="uq-stat">
      <span className="uq-stat-label" title={label}>
        {label}
      </span>
      <div className="uq-stat-main">
        <span className="uq-stat-value" title={value}>
          {value}
        </span>
        {extra}
      </div>
      <span className="uq-stat-sub" title={sub}>
        {sub}
      </span>
    </div>
  );
}

/** 汇总条：最紧的额度、过去一年、最近 30 天（带迷你柱状图）、最忙的一天。读不到的那一格写 —。 */
export function SummaryStrip({ quota, heatmap }: { quota: QuotaSnapshot | null; heatmap: UsageHeatmap | null }) {
  const t = useT();
  const locale = useLocale();
  const tightest = useMemo(() => (quota ? tightestQuota(quota.accounts) : null), [quota]);
  const summary = useMemo(() => (heatmap?.hasDatabase ? summarizeUsage(heatmap) : null), [heatmap]);
  const requests = (count: number) => t("usage.summary.requests", { count, value: compact(locale, count) });
  const sparkMax = Math.max(0, ...(summary?.spark ?? []));
  const busiestDate = summary?.busiest
    ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
        parseDate(summary.busiest.date),
      )
    : null;
  return (
    <div className="uq-summary" data-testid="usage-summary" role="group" aria-label={t("usage.summary")}>
      <div className="uq-strip">
        <Stat
          label={t("usage.summary.tightest")}
          value={tightest ? t("usage.quota.left", { percent: leftPercent(tightest.limit) ?? 0 }) : "—"}
          sub={
            tightest
              ? t("usage.summary.tightest.sub", {
                  limit: limitName(tightest.limit),
                  provider: tightest.account.provider,
                })
              : t("usage.summary.noQuota")
          }
        />
        <Stat
          label={t("usage.summary.pastYear")}
          value={summary ? money(locale, summary.pastYear.costUsd) : "—"}
          sub={summary ? requests(summary.pastYear.requests) : ""}
        />
        <Stat
          label={t("usage.summary.last30")}
          value={summary ? money(locale, summary.last30.costUsd) : "—"}
          sub={summary ? requests(summary.last30.requests) : ""}
          extra={
            summary && (
              <span className="uq-spark" aria-hidden="true">
                {summary.spark.map((cost, i) => (
                  <span
                    // 30 根柱子按位置固定，没有别的稳定 key
                    key={i}
                    className="uq-spark-bar"
                    data-zero={cost <= 0 || undefined}
                    style={{ height: sparkMax > 0 ? `${(cost / sparkMax) * 100}%` : "0%" }}
                  />
                ))}
              </span>
            )
          }
        />
        <Stat
          label={t("usage.summary.busiest")}
          value={summary?.busiest ? money(locale, summary.busiest.costUsd) : "—"}
          sub={summary?.busiest && busiestDate ? `${busiestDate} · ${requests(summary.busiest.requests)}` : ""}
        />
      </div>
    </div>
  );
}

export function MetricSwitch({
  value,
  onChange,
  labelledBy,
}: {
  value: Metric;
  onChange(next: Metric): void;
  labelledBy: string;
}) {
  const t = useT();
  const options: Option<Metric>[] = [
    { value: "tokens", label: t("usage.heatmap.tokens") },
    { value: "cost", label: t("usage.heatmap.cost") },
    { value: "requests", label: t("usage.heatmap.requests") },
  ];
  return (
    <Segmented<Metric>
      value={value}
      options={options}
      labelledBy={labelledBy}
      onChange={onChange}
      testId="usage-metric"
    />
  );
}

interface Cell {
  date: string;
  day: UsageDay | null;
  /** 在 from..to 之内（之外的是补齐周用的空位）。 */
  inWindow: boolean;
}

/** 从 from 那天所在的周（周一起）开始，按列（周）× 行（周一..周日）排满到 to。 */
function layoutDays(heatmap: UsageHeatmap): Cell[][] {
  const byDate = new Map(heatmap.days.map((day) => [day.date, day]));
  const start = parseDate(heatmap.from);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = parseDate(heatmap.to);
  const weeks: Cell[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: Cell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = dateText(cursor);
      const inWindow = date >= heatmap.from && date <= heatmap.to;
      week.push({ date, day: inWindow ? (byDate.get(date) ?? null) : null, inWindow });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function metricValue(day: UsageDay, metric: Metric): number {
  return metric === "tokens" ? day.tokens : metric === "cost" ? day.costUsd : day.requests;
}

/** 每列（周）上方的月份标签：含 1 号的那一周写月份；第一列没有标签又不挤着第二列时补一个。 */
function monthLabels(weeks: readonly Cell[][], locale: Locale): (string | null)[] {
  const format = new Intl.DateTimeFormat(locale, { month: "short" });
  const monthOf = (date: string) => format.format(new Date(2000, Number(date.slice(5, 7)) - 1, 1));
  const labels = weeks.map((week) => {
    const first = week.find((cell) => cell.date.endsWith("-01"));
    return first ? monthOf(first.date) : null;
  });
  const lead = weeks[0]?.find((cell) => cell.inWindow);
  if (lead && labels[0] === null && labels[1] === null) labels[0] = monthOf(lead.date);
  return labels;
}

// 周一、周三、周五标在对应行；2024-01-01 是周一。
const weekdayRows = [0, 2, 4];

/**
 * 热力图本体（不带外框）：左边星期、上面月份、中间格子、下面"N 天有记录 · 最长连续 N 天"和图例。
 * recentWeeks 给了就只画最近这么多周（浮层里放不下一整年），统计和颜色档位也只按这几周算。
 */
export function HeatmapView({
  heatmap,
  metric,
  recentWeeks,
}: {
  heatmap: UsageHeatmap;
  metric: Metric;
  recentWeeks?: number;
}) {
  const t = useT();
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  // 一年的格子比卡片宽：默认停在最近的一端。
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth });
  }, [heatmap, recentWeeks]);
  const weeks = useMemo(() => {
    const all = layoutDays(heatmap);
    return recentWeeks === undefined ? all : all.slice(-recentWeeks);
  }, [heatmap, recentWeeks]);
  const labels = useMemo(() => monthLabels(weeks, locale), [weeks, locale]);
  const days = useMemo(() => {
    if (recentWeeks === undefined) return heatmap.days;
    const from = weeks[0]?.[0]?.date ?? heatmap.from;
    return heatmap.days.filter((day) => day.date >= from);
  }, [heatmap, weeks, recentWeeks]);
  const stats = useMemo(() => activityStats(days), [days]);
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, row) =>
      weekdayRows.includes(row) ? format.format(new Date(2024, 0, 1 + row)) : null,
    );
  }, [locale]);
  const max = Math.max(0, ...days.map((day) => metricValue(day, metric)));
  // 按花费着色时悬停一并给出请求数（浮层里只看花费，不再有指标切换）。
  const format = (day: UsageDay) =>
    metric === "cost"
      ? `${money(locale, day.costUsd, 2)} · ${t("usage.summary.requests", { count: day.requests, value: compact(locale, day.requests) })}`
      : compact(locale, metricValue(day, metric));
  // 5 档：0 = 无记录；1..4 按占最大值的比例。
  const level = (day: UsageDay | null) => {
    const value = day ? metricValue(day, metric) : 0;
    return value <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
  };
  return (
    <div className="uq-heat" data-compact={recentWeeks !== undefined || undefined}>
      <div className="uq-heat-body">
        <div className="uq-weekdays" aria-hidden="true">
          {weekdays.map((name, row) => (
            <span key={row} className="uq-weekday">
              {name}
            </span>
          ))}
        </div>
        <div ref={scroller} className="usage-scroll">
          <div className="uq-months" aria-hidden="true">
            {weeks.map((week, i) => (
              <span key={week[0]?.date} className="uq-month">
                {labels[i]}
              </span>
            ))}
          </div>
          <div className="usage-grid" role="img" aria-label={t("usage.heatmap")}>
            {weeks.map((week) => (
              <div key={week[0]?.date} className="usage-week">
                {week.map(({ date, day, inWindow }) => (
                  <span
                    key={date}
                    className="usage-cell"
                    data-level={level(day)}
                    data-empty={!inWindow || undefined}
                    title={
                      inWindow
                        ? t("usage.heatmap.day", {
                            date,
                            value: day ? format(day) : t("usage.heatmap.none"),
                          })
                        : undefined
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="uq-heat-foot">
        <span className="uq-muted">
          {t("usage.heatmap.active", { count: stats.activeDays })} ·{" "}
          {t("usage.heatmap.streak", { count: stats.longestStreak })}
        </span>
        <span className="uq-legend uq-muted">
          {t("usage.heatmap.less")}
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className="usage-cell" data-level={n} />
          ))}
          {t("usage.heatmap.more")}
        </span>
      </div>
    </div>
  );
}
