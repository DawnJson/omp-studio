// 新任务页的"本周用量"卡片：近 7 天 token 合计 + 费用、今天的 token，底下是近几周每天一列的点阵（静态 SVG，只有最近 7 天用强调色）。
// 数据和"用量"对话框共用 composer/usage-store 的热力图缓存；还没读过时在这里读一次。
// 读不到（出错且没有缓存）就不显示这张卡片；omp 还没建过统计库时只写一句说明，不编数字。
import { useEffect, useMemo } from "react";
import { useT } from "../../i18n/use-t.ts";
import { loadHeatmap, useUsageHeatmap } from "../composer/usage-store.ts";
import { formatCost } from "../tsp/fmt.ts";
import { formatTokens } from "../tsp/turn-footer.ts";
import { localDateText, MAX_DOTS, OVERVIEW_WEEKS, usageOverview, type UsageOverview } from "./usage-overview.ts";

const PITCH = 8;
const RADIUS = 2.5;

/** 宽高只在 viewBox 里：CSS 给 width: 100%、height: auto，按比例铺满卡片宽，点不会被拉扁。 */
function DotChart({ overview, label }: { overview: UsageOverview; label: string }) {
  const width = overview.columns.length * PITCH;
  const height = MAX_DOTS * PITCH;
  const last = overview.columns.length - 1;
  return (
    <svg
      className="eu-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-testid="empty-usage-chart"
    >
      {overview.columns.map((column, x) =>
        Array.from({ length: MAX_DOTS }, (_, level) => (
          <circle
            key={`${column.date}:${level}`}
            className="eu-dot"
            cx={x * PITCH + PITCH / 2}
            cy={height - level * PITCH - PITCH / 2}
            r={RADIUS}
            data-on={level < column.dots || undefined}
            data-recent={column.recent || undefined}
            data-today={x === last || undefined}
          />
        )),
      )}
    </svg>
  );
}

export function UsageCard() {
  const t = useT();
  const heatmap = useUsageHeatmap();
  useEffect(() => {
    if (heatmap.data === null && !heatmap.busy) void loadHeatmap();
    // 只在挂载时读一次；失败了不在这里反复重试。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const data = heatmap.data;
  const overview = useMemo(() => usageOverview(data ?? { to: localDateText(new Date()), days: [] }), [data]);

  if (data === null && heatmap.error !== null) return null;
  const title = (
    <h2 className="eu-label" id="empty-usage-title">
      {t("empty.usageTitle")}
    </h2>
  );

  if (data !== null && !data.hasDatabase) {
    return (
      <section className="eu" data-testid="empty-usage" data-state="no-database" aria-labelledby="empty-usage-title">
        {title}
        <p className="eu-note">{t("empty.usageNoDatabase")}</p>
      </section>
    );
  }

  const week = `${formatTokens(overview.weekTokens)} tok`;
  const today = formatTokens(overview.todayTokens);
  return (
    <section
      className="eu"
      data-testid="empty-usage"
      data-state={data === null ? "loading" : "ready"}
      aria-labelledby="empty-usage-title"
      aria-busy={data === null || undefined}
    >
      <div className="eu-head">
        <div>
          {title}
          <div className="eu-figures">
            {data === null ? (
              <span className="eu-placeholder" role="status" aria-label={t("empty.usageLoading")} />
            ) : (
              <>
                <span className="eu-total" data-testid="empty-usage-total">
                  {week}
                </span>
                <span className="eu-cost">{formatCost(overview.weekCost)}</span>
              </>
            )}
          </div>
        </div>
        {data !== null && <span className="eu-chip">{t("empty.usageToday", { value: today })}</span>}
      </div>
      <DotChart
        overview={overview}
        label={
          data === null
            ? t("empty.usageLoading")
            : t("empty.usageChart", { weeks: OVERVIEW_WEEKS, week, today: `${today} tok` })
        }
      />
    </section>
  );
}
