// 输入框工具行里的用量仪表（输入框下方不再有单独一行），等宽小字：
// 模型、审批胶囊右边是本会话 token 和速度（UsageMeter）；发送键左边依次是上下文圆环（ContextMeter）和费用（SessionCost）。
// 点圆环弹出上下文构成（任务里还有"压缩上下文"）；点本会话 token 弹出按模型的明细。
import { useState, type ReactNode } from "react";
import type { ModelOption, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { compactContext } from "./actions.ts";
import { ContextBreakdown, type ContextBreakdownProps } from "./ContextBreakdown.tsx";
import { ModelBreakdown } from "./ModelBreakdown.tsx";
import { Popover } from "./Popover.tsx";
import { formatTokensPerSecond } from "./speed-limit-format.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

const ringSize = 20;
const ringRadius = 8;
const ringLength = 2 * Math.PI * ringRadius;

function Ring({ percent }: { percent: number }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * ringLength;
  const center = ringSize / 2;
  return (
    <svg
      className="usage-ring"
      width={ringSize}
      height={ringSize}
      viewBox={`0 0 ${ringSize} ${ringSize}`}
      aria-hidden="true"
    >
      <circle className="usage-ring-track" cx={center} cy={center} r={ringRadius} />
      <circle
        className="usage-ring-fill"
        cx={center}
        cy={center}
        r={ringRadius}
        strokeDasharray={`${filled} ${ringLength}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

/** 上下文占用：只有圆环（百分比和已用/总量在悬停提示和构成里），点开是上下文构成；footer 放在构成下面。 */
function ContextButton({ footer, ...props }: ContextBreakdownProps & { footer?: (close: () => void) => ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { context } = props;
  const close = () => setOpen(false);
  const label = t("composer.context", { p: formatPercent(context.percent) });
  return (
    <div className="pop-anchor usage-context-anchor">
      <button
        type="button"
        className="usage-context"
        data-high={context.percent >= 90 || undefined}
        data-testid="context-meter"
        aria-label={label}
        title={`${label} · ${t("composer.usage.context", {
          used: formatCount(context.tokens),
          total: formatCount(context.contextWindow),
        })}\n${t("composer.context.tip")}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Ring percent={context.percent} />
      </button>
      <Popover open={open} onClose={close} width={320} align="end" label={label}>
        <ContextBreakdown {...props} />
        {footer?.(close)}
      </Popover>
    </div>
  );
}

/** 任务的上下文圆环（发送键左边、费用之前）；omp 还没给出上下文占用时不显示。 */
export function ContextMeter({ task }: { task: TaskState }) {
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

/** 新任务草稿的上下文圆环：还没有会话，占用是 0，窗口取所选模型的；模型没报窗口就不显示。 */
export function DraftContextMeter({ model, projectId }: { model: ModelOption | null; projectId: ProjectId | null }) {
  const window = model?.contextWindow ?? null;
  if (window === null || window <= 0) return null;
  return (
    <ContextButton
      context={{ tokens: 0, contextWindow: window, percent: 0 }}
      parts={null}
      modelKey={model?.key ?? null}
      projectId={projectId}
    />
  );
}

function TokensMeter({ usage, task }: { usage: NonNullable<TaskState["sessionUsage"]>; task: TaskState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
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

/** 工具行里模型/审批胶囊右边的仪表：本会话 token、速度。窄输入框逐级收起；都没有时不渲染。 */
export function UsageMeter({ task }: { task: TaskState }) {
  const t = useT();
  const busy = task.status === "running" || task.status === "needs_you";
  // omp 只在回复结束后给出速度（实测流式中为 null）；运行中显示的是上一条回复的，空闲时不再显示。
  const speedText = busy ? formatTokensPerSecond(task.tokensPerSecond) : null;
  const usage = task.sessionUsage;
  if (usage === null && speedText === null) return null;
  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      {usage !== null && <TokensMeter usage={usage} task={task} />}
      {speedText !== null && (
        <span className="usage-item usage-tps" data-testid="usage-tps" title={t("composer.usage.tpsTip")}>
          {t("composer.usage.tps", { n: speedText })}
        </span>
      )}
    </div>
  );
}
