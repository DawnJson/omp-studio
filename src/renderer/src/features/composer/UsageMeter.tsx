// 输入框工具行里的用量仪表（输入框下方不再有单独一行），等宽小字，紧跟模型、审批胶囊：
// 上下文（圆环 + 百分比）、本会话 token、速度、每日用量、订阅额度，各自点开一个浮层。费用在发送键左边（SessionCost）。
// 点上下文弹出上下文构成 + "压缩上下文"；点本会话 token 弹出按模型的明细。新任务草稿只有上下文（0%）、每日用量和额度。
import { useState, type ReactNode } from "react";
import type { ModelOption, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { compactContext } from "./actions.ts";
import { ContextBreakdown, type ContextBreakdownProps } from "./ContextBreakdown.tsx";
import { ModelBreakdown } from "./ModelBreakdown.tsx";
import { Popover } from "./Popover.tsx";
import { DailyUsageMeter, QuotaMeter } from "./QuotaMeter.tsx";
import { formatTokensPerSecond } from "./speed-limit-format.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

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

/** 上下文占用：圆环 + 百分比（已用/总量在悬停提示里），点开是上下文构成；footer 放在构成下面（任务里是"压缩上下文"）。 */
function ContextButton({ footer, ...props }: ContextBreakdownProps & { footer?: (close: () => void) => ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { context } = props;
  const close = () => setOpen(false);
  return (
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
        onClick={() => setOpen(!open)}
      >
        <Ring percent={context.percent} />
        <span>{t("composer.context", { p: formatPercent(context.percent) })}</span>
      </button>
      <Popover
        open={open}
        onClose={close}
        width={320}
        label={t("composer.context", { p: formatPercent(context.percent) })}
      >
        <ContextBreakdown {...props} />
        {footer?.(close)}
      </Popover>
    </div>
  );
}

function ContextMeter({ task }: { task: TaskState }) {
  const t = useT();
  const context = task.contextUsage;
  if (context === null) return null;
  const busy = task.status === "running" || task.status === "needs_you";
  return (
    <ContextButton
      context={context}
      parts={task.contextParts}
      modelKey={task.model?.key ?? null}
      projectId={task.projectId}
      footer={(close) => (
        <div className="pop-section">
          <button
            type="button"
            className="gate-btn"
            data-primary
            disabled={busy}
            onClick={() => {
              close();
              void compactContext(task.id, t);
            }}
          >
            {t("composer.compact")}
          </button>
        </div>
      )}
    />
  );
}

function TokensMeter({ task }: { task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const usage = task.sessionUsage;
  if (usage === null) return null;
  return (
    <div className="pop-anchor">
      <button
        type="button"
        className="usage-item"
        data-testid="usage-tokens"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("composer.usage.tokens", { n: formatCount(usage.tokens.total) })}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={300} label={t("composer.breakdown.title")}>
        <ModelBreakdown task={task} />
      </Popover>
    </div>
  );
}

/** 工具行里模型/审批胶囊右边的仪表：上下文、本会话 token、速度、每日用量、额度。窄输入框逐级只留上下文。 */
export function UsageMeter({ task }: { task: TaskState }) {
  const t = useT();
  const busy = task.status === "running" || task.status === "needs_you";
  // omp 只在回复结束后给出速度（实测流式中为 null）；运行中显示的是上一条回复的，空闲时不再显示。
  const speedText = busy ? formatTokensPerSecond(task.tokensPerSecond) : null;
  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      <ContextMeter task={task} />
      <TokensMeter task={task} />
      {speedText !== null && (
        <span className="usage-item usage-tps" data-testid="usage-tps" title={t("composer.usage.tpsTip")}>
          {t("composer.usage.tps", { n: speedText })}
        </span>
      )}
      <DailyUsageMeter />
      <QuotaMeter provider={task.model?.key.provider ?? null} refreshKey={task.updatedAt} />
    </div>
  );
}

/** 新任务草稿的仪表：还没有会话，上下文是 0（窗口取所选模型的；模型没报窗口就不显示），本会话 token 要发出第一条消息后才有；
 *  每日用量和额度与会话无关，照样显示。 */
export function DraftUsageMeter({ model, projectId }: { model: ModelOption | null; projectId: ProjectId | null }) {
  const t = useT();
  const window = model?.contextWindow ?? null;
  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      {window !== null && window > 0 && (
        <ContextButton
          context={{ tokens: 0, contextWindow: window, percent: 0 }}
          parts={null}
          modelKey={model?.key ?? null}
          projectId={projectId}
          draft
        />
      )}
      <DailyUsageMeter />
      <QuotaMeter provider={model?.key.provider ?? null} />
    </div>
  );
}
