// 输入框下方的仪表行（方向 A）：上下文占用（圆环 + 百分比 + 已用/总量）、本会话 token、费用，等宽字体。
// 没有任何数据时整行不渲染。点上下文部分弹出"压缩上下文"。窄输入框只留上下文和费用。
import { useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { compactContext } from "./actions.ts";
import { Popover } from "./Popover.tsx";
import { formatCount, formatMoney, formatPercent } from "./usage-format.ts";

const ringRadius = 5;
const ringLength = 2 * Math.PI * ringRadius;

function Ring({ percent }: { percent: number }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * ringLength;
  return (
    <svg className="usage-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle className="usage-ring-track" cx="7" cy="7" r={ringRadius} />
      <circle
        className="usage-ring-fill"
        cx="7"
        cy="7"
        r={ringRadius}
        strokeDasharray={`${filled} ${ringLength}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

export function UsageMeter({ task }: { task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const context = task.contextUsage;
  const usage = task.sessionUsage;
  if (context === null && usage === null) return null;

  const busy = task.status === "running" || task.status === "needs_you";
  const detail = usage
    ? [
        `${t("composer.usage.input")} ${formatCount(usage.tokens.input)}`,
        `${t("composer.usage.output")} ${formatCount(usage.tokens.output)}`,
        `${t("composer.usage.cache")} ${formatCount(usage.tokens.cacheRead)}`,
        ...(usage.premiumRequests > 0 ? [t("composer.usage.premium", { n: usage.premiumRequests })] : []),
      ].join(" · ")
    : undefined;

  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      {context !== null && (
        <div className="pop-anchor">
          <button
            type="button"
            className="usage-item usage-context"
            data-high={context.percent >= 90 || undefined}
            data-testid="context-meter"
            title={`${t("composer.usage.context", {
              used: formatCount(context.tokens),
              total: formatCount(context.contextWindow),
            })} · ${t("composer.context.tip")}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Ring percent={context.percent} />
            <span>{t("composer.context", { p: formatPercent(context.percent) })}</span>
            <span className="usage-total">
              {formatCount(context.tokens)}/{formatCount(context.contextWindow)}
            </span>
          </button>
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            width={240}
            label={t("composer.context", { p: formatPercent(context.percent) })}
          >
            <div className="pop-section">
              <button
                type="button"
                className="gate-btn"
                data-primary
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void compactContext(task.id, t);
                }}
              >
                {t("composer.compact")}
              </button>
            </div>
          </Popover>
        </div>
      )}
      {usage !== null && (
        <span className="usage-item" data-testid="usage-tokens" title={detail}>
          {t("composer.usage.tokens", { n: formatCount(usage.tokens.total) })}
        </span>
      )}
      {usage !== null && usage.cost > 0 && (
        <span className="usage-item" data-testid="usage-cost" title={detail}>
          {formatMoney(usage.cost)}
        </span>
      )}
    </div>
  );
}
