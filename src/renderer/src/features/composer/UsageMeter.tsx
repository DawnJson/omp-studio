// 输入框工具行里的用量仪表（输入框下方不再有单独一行）：
// 模型、审批胶囊右边是速度（UsageMeter，只在运行中）；发送键左边依次是上下文圆环（ContextMeter）和费用（SessionCost）。
// 点圆环弹出上下文构成；任务里构成下面有"会话用量"按钮，点了在构成左边展开按模型的本会话用量（ModelBreakdown）。
import { useEffect, useState, type ReactNode } from "react";
import type { ModelOption, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { ContextBreakdown, prefetchCompaction, type ContextBreakdownProps } from "./ContextBreakdown.tsx";
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

const contextWidth = 320;
const usageWidth = 300;

/**
 * 上下文占用：只有圆环（百分比和已用/总量在悬停提示和构成里），点开是上下文构成。
 * 给了 sessionUsage 时构成下面有"会话用量"按钮，点了浮层向左加宽，左边是它（右边的构成不动）；关掉浮层就收回。
 */
function ContextButton({ sessionUsage, ...props }: ContextBreakdownProps & { sessionUsage?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const { context, projectId } = props;
  useEffect(() => prefetchCompaction(projectId), [projectId]);
  const close = () => {
    setOpen(false);
    setUsageOpen(false);
  };
  const label = t("composer.context", { p: formatPercent(context.percent) });
  const expanded = usageOpen && sessionUsage !== undefined;
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
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Ring percent={context.percent} />
      </button>
      <Popover
        open={open}
        onClose={close}
        width={expanded ? contextWidth + usageWidth : contextWidth}
        align="end"
        label={label}
      >
        <div className="ctx-pop" data-expanded={expanded || undefined}>
          {expanded && (
            <div className="ctx-pop-aside" data-testid="session-usage">
              {sessionUsage}
            </div>
          )}
          <div className="ctx-pop-main">
            <ContextBreakdown {...props} />
            {sessionUsage !== undefined && (
              <div className="pop-section">
                <button
                  type="button"
                  className="gate-btn"
                  data-testid="session-usage-toggle"
                  aria-expanded={expanded}
                  onClick={() => setUsageOpen(!usageOpen)}
                >
                  {t("composer.breakdown.toggle")}
                </button>
              </div>
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}

/** 还没有上下文数据时的占位：同一位置、同样大小的空圆环，不能点；数据到了换成可点的圆环。 */
function ContextPlaceholder() {
  return (
    <span className="usage-context-anchor" aria-hidden="true">
      <span className="usage-context" data-pending data-testid="context-meter-pending">
        <Ring percent={0} />
      </span>
    </span>
  );
}

/** 任务的上下文圆环（发送键左边、费用之前）；omp 还没给出上下文占用时是占位圆环。 */
export function ContextMeter({ task }: { task: TaskState }) {
  const context = task.contextUsage;
  if (context === null) return <ContextPlaceholder />;
  return (
    <ContextButton
      context={context}
      parts={task.contextParts}
      modelKey={task.model?.key ?? null}
      projectId={task.projectId}
      sessionUsage={<ModelBreakdown task={task} />}
    />
  );
}

/** 新任务草稿的上下文圆环：还没有会话，占用是 0，窗口取所选模型的；模型还没读到或没报窗口时是占位圆环。 */
export function DraftContextMeter({ model, projectId }: { model: ModelOption | null; projectId: ProjectId | null }) {
  const window = model?.contextWindow ?? null;
  if (window === null || window <= 0) return <ContextPlaceholder />;
  return (
    <ContextButton
      context={{ tokens: 0, contextWindow: window, percent: 0 }}
      parts={null}
      modelKey={model?.key ?? null}
      projectId={projectId}
    />
  );
}

/** 工具行里模型/审批胶囊右边的速度：omp 只在回复结束后给出（实测流式中为 null）；运行中显示的是上一条回复的，空闲时不显示。 */
export function UsageMeter({ task }: { task: TaskState }) {
  const t = useT();
  const busy = task.status === "running" || task.status === "needs_you";
  const speedText = busy ? formatTokensPerSecond(task.tokensPerSecond) : null;
  if (speedText === null) return null;
  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      <span className="usage-item usage-tps" data-testid="usage-tps" title={t("composer.usage.tpsTip")}>
        {t("composer.usage.tps", { n: speedText })}
      </span>
    </div>
  );
}
