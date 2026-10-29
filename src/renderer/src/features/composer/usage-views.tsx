// 用量对话框（点发送键左边的费用打开）的视图：汇总条、账号额度块、每日花费热力图。
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type {
  Locale,
  QuotaAccount,
  QuotaLimit,
  QuotaResetCredits,
  QuotaSnapshot,
  QuotaUnavailable,
  UsageDay,
  UsageHeatmap,
} from "../../../../shared/ipc.ts";
import { formatQuotaReset } from "../../../../shared/ui/reset-time.ts";
import {
  activityStats,
  creditExpiry,
  leftPercent,
  summarizeUsage,
  tightestQuota,
} from "../../../../shared/ui/usage-summary.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { Badge } from "../../ui/controls.tsx";
import { useCoarseNow } from "../sidebar/task-time.ts";
import "./usage.css";

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

/** 名字里已经带了时长（数字或 小时 / 天 / 周 / 月 / hour / day / week / month 之类）的不再补窗口缩写。 */
const DURATION_WORD = /\d|hour|day|week|month|daily|小时|天|日|周|月/i;

/** 有的 provider 把窗口写进了名字（"Claude 5 Hour"、"Opus 每周"），有的没有（"Gemini"）：名字里没有时长才补
 *  " · 7d"，不然就是"5 小时 · 5h"这种同一件事说两遍。 */
function limitName(limit: QuotaLimit): string {
  const base = limit.label || limit.id;
  return limit.windowLabel && !DURATION_WORD.test(base) ? `${base} · ${limit.windowLabel}` : base;
}

/** 一个额度窗口一行：名称 | 进度条（剩余） | 剩余百分比 | 重置时间。窄了名称在上、条在下。 */
function QuotaLimitRow({ limit }: { limit: QuotaLimit }) {
  const t = useT();
  const locale = useLocale();
  const now = useCoarseNow();
  const left = leftPercent(limit);
  const name = limitName(limit);
  const status =
    limit.status === "exhausted"
      ? t("usage.quota.exhausted")
      : left === null
        ? t("usage.quota.unknown")
        : t("usage.quota.left", { percent: left });
  const reset =
    limit.resetsAt === null ? null : t("usage.quota.resets", { time: formatQuotaReset(locale, limit.resetsAt, now) });
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

/** 重置券徽章（omp 的 "N resets banked"，`usage-dashboard.ts:648-667`）：悬停带"现在可用几次 · 到期时间 · 不可用原因"。 */
function ResetCreditsBadge({ credits }: { credits: QuotaResetCredits }) {
  const t = useT();
  const locale = useLocale();
  const now = useCoarseNow();
  const parts: string[] = [];
  if (credits.redeemableCount !== credits.bankedCount)
    parts.push(t("usage.quota.credits.usable", { count: credits.redeemableCount }));
  if (credits.soonestExpiryAt !== null) {
    const left = creditExpiry(credits.soonestExpiryAt, now);
    parts.push(
      left === null
        ? t("usage.quota.credits.expired")
        : t("usage.quota.credits.expires", {
            when: new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" }).format(
              left.value,
              left.unit,
            ),
          }),
    );
  }
  if (credits.redeemableCount === 0 && credits.unavailableReason !== null)
    parts.push(t("usage.quota.credits.unavailable", { reason: credits.unavailableReason }));
  const label = t("usage.quota.credits", { count: credits.bankedCount });
  return (
    <Badge
      tone={credits.redeemableCount > 0 ? "success" : "warning"}
      title={parts.length > 0 ? `${label} · ${parts.join(" · ")}` : label}
      testId="usage-credits"
    >
      {label}
    </Badge>
  );
}

/** 套餐到期 / 续费：自动续费的写"某日续费"，不续费的写"某日到期 · 不自动续费"，过了的写"已于某日到期"；只知道续不续费时只写这一句。 */
function planTermText(account: QuotaAccount, now: number, t: ReturnType<typeof useT>): string | null {
  const { planEndsAt, autoRenew } = account;
  if (planEndsAt === null) {
    if (autoRenew === null) return null;
    return t(autoRenew ? "usage.quota.plan.autoRenew" : "usage.quota.plan.noRenew");
  }
  const date = dateText(new Date(planEndsAt));
  if (planEndsAt <= now) return t("usage.quota.plan.ended", { date });
  if (autoRenew === true) return t("usage.quota.plan.renews", { date });
  const ends = t("usage.quota.plan.ends", { date });
  return autoRenew === false ? `${ends} · ${t("usage.quota.plan.noRenew")}` : ends;
}

/** 一个账号一块：左边状态点 + provider（套餐 / Daybreak）+ 账号 + 套餐到期 / 续费 + 备注 + 重置券，右边是各窗口的行。 */
export function QuotaBlock({ account }: { account: QuotaAccount }) {
  const t = useT();
  const now = useCoarseNow();
  const term = planTermText(account, now, t);
  return (
    <section className="uq-block" data-testid="usage-account">
      <div className="uq-block-grid">
        <div className="uq-block-head">
          <div className="uq-block-name">
            <span className="uq-dot" data-status={accountStatus(account)} aria-hidden="true" />
            <strong title={account.provider}>{account.provider}</strong>
            {account.planType !== null && (
              <Badge testId="usage-plan" title={account.planType}>
                {account.planType}
              </Badge>
            )}
            {account.daybreak && (
              <Badge tone="success" testId="usage-daybreak">
                {t("usage.quota.daybreak")}
              </Badge>
            )}
          </div>
          {account.account && (
            <span className="uq-muted" title={account.account}>
              {account.account}
            </span>
          )}
          {term !== null && (
            <span className="uq-muted" title={term} data-testid="usage-plan-term">
              {term}
            </span>
          )}
          {account.notes.map((note) => (
            <span key={note} className="uq-muted" title={note}>
              {note}
            </span>
          ))}
          {account.resetCredits !== null && <ResetCreditsBadge credits={account.resetCredits} />}
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

/** 登录了但 omp 取不到用量的账号：一行 "<账号>: usage unavailable"（omp 面板同样）。 */
export function UnavailableRow({ item }: { item: QuotaUnavailable }) {
  const t = useT();
  const text = t("usage.quota.accountUnavailable", { account: `${item.provider} · ${item.label}` });
  return (
    <div className="uq-untouched" data-testid="usage-unavailable">
      <span className="uq-muted" title={text}>
        {text}
      </span>
    </div>
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

function Stat({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
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
    </div>
  );
}

/** 汇总条：最紧的额度、过去一年、最近 30 天（带迷你柱状图）、最忙的一天。读不到的那一格写 —。 */
export function SummaryStrip({ quota, heatmap }: { quota: QuotaSnapshot | null; heatmap: UsageHeatmap | null }) {
  const t = useT();
  const locale = useLocale();
  const tightest = useMemo(() => (quota ? tightestQuota(quota.accounts) : null), [quota]);
  const summary = useMemo(() => (heatmap?.hasDatabase ? summarizeUsage(heatmap) : null), [heatmap]);
  const sparkMax = Math.max(0, ...(summary?.spark ?? []));
  return (
    <div className="uq-summary" data-testid="usage-summary" role="group" aria-label={t("usage.summary")}>
      <div className="uq-strip">
        <Stat
          label={t("usage.summary.tightest")}
          value={tightest ? t("usage.quota.left", { percent: leftPercent(tightest.limit) ?? 0 }) : "—"}
        />
        <Stat label={t("usage.summary.pastYear")} value={summary ? money(locale, summary.pastYear.costUsd) : "—"} />
        <Stat
          label={t("usage.summary.last30")}
          value={summary ? money(locale, summary.last30.costUsd) : "—"}
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
        />
      </div>
    </div>
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
  // cursor 是 Date，循环体里用 setDate 原地往后推。
  // eslint-disable-next-line no-unmodified-loop-condition
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
const weekdayRows = new Set([0, 2, 4]);

/**
 * 热力图本体（不带外框）：左边星期、上面月份、中间格子（按花费着色）、下面"N 天有记录 · 最长连续 N 天"和图例。
 * 画全部周（一年 53 周），格子边长按容器宽度算（铺满、不出横向滚动条）。
 */
export function HeatmapView({ heatmap }: { heatmap: UsageHeatmap }) {
  const t = useT();
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => layoutDays(heatmap), [heatmap]);
  const labels = useMemo(() => monthLabels(weeks, locale), [weeks, locale]);
  const weekCount = weeks.length;
  useLayoutEffect(() => {
    const host = root.current;
    const area = scroller.current;
    if (!host || !area || weekCount === 0) return;
    const gap = 3;
    const apply = () => {
      const cell = (area.clientWidth - gap * (weekCount - 1)) / weekCount;
      if (cell > 0) host.style.setProperty("--uq-cell", `${Math.min(cell, 24).toFixed(2)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(area);
    return () => observer.disconnect();
  }, [weekCount]);
  const stats = useMemo(() => activityStats(heatmap.days), [heatmap]);
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, row) =>
      weekdayRows.has(row) ? format.format(new Date(2024, 0, 1 + row)) : null,
    );
  }, [locale]);
  const max = Math.max(0, ...heatmap.days.map((day) => day.costUsd));
  // 悬停给金额和请求数。
  const format = (day: UsageDay) =>
    `${money(locale, day.costUsd, 2)} · ${t("usage.summary.requests", { count: day.requests, value: compact(locale, day.requests) })}`;
  // 5 档：0 = 无记录；1..4 按占最大值的比例。
  const level = (day: UsageDay | null) => {
    const value = day?.costUsd ?? 0;
    return value <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
  };
  return (
    <div ref={root} className="uq-heat">
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
            {/* 最后两列放不下整个标签：改成靠右，文字在格子区右边缘结束（前一个标签至少隔 4 列，不会叠上）。 */}
            {weeks.map((week, i) => (
              <span key={week[0]?.date} className="uq-month" data-end={i >= weekCount - 2 || undefined}>
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
