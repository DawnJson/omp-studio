// 输入框工具行里的用量仪表（输入框下方不再有单独一行）：
// 模型、审批胶囊右边是速度（UsageMeter，只在运行中）；发送键左边依次是上下文圆环（ContextMeter）和费用（SessionCost）。
// 点圆环弹出上下文构成；任务里有回复后，构成左边一直带着按模型的本会话用量（ModelBreakdown）。
import { useEffect, useState, type ReactNode } from "react";
import type { ModelOption, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { DraftContextBreakdown, prefetchCompaction, TaskContextBreakdown } from "./ContextBreakdown.tsx";
import { hasModelUsage, ModelBreakdown, useModelUsage } from "./ModelBreakdown.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { onStudioCommand } from "../palette/studio-command.ts";
import { useSessionExtras } from "../tsp/session-extras-store.ts";
import { formatTokensPerSecond } from "./speed-limit-format.ts";
import { useTspDerived } from "../tsp/tsp-store.ts";
import { deriveComposerFacts, sameComposerFacts } from "../../../../shared/tsp/composer-facts.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

const ringSize = 20;
const ringRadius = 8;
/** 已用画成圆环里的扇形（半径 3、描边 6 的圆：描边正好铺满半径 6 的饼）：占用很少时是一道细楔子，不会像转圈的加载弧。 */
const pieRadius = 3;
const pieLength = 2 * Math.PI * pieRadius;

/** 圆环：外圈是底，里面的扇形 = 已用；`autoAt`（0–100）是自动压缩触发点，在外圈上向里画一道刻度。
 * 没用量时不画扇形（长度 0 的虚线 Chromium 仍画出一个小竖点），刻度也不伸出外圈：两者叠在一起像"刷新"图标（2026-10-29 审计）。 */
function Ring({ percent, autoAt = null }: { percent: number; autoAt?: number | null }) {
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * pieLength;
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
      {filled > 0 && (
        <circle
          className="usage-ring-fill"
          cx={center}
          cy={center}
          r={pieRadius}
          strokeDasharray={`${filled} ${pieLength}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      {autoAt !== null && (
        <line
          className="usage-ring-tick"
          data-testid="context-ring-tick"
          data-at={autoAt}
          x1={center}
          y1={center - ringRadius}
          x2={center}
          y2={center - ringRadius + 3}
          transform={`rotate(${(Math.min(100, Math.max(0, autoAt)) / 100) * 360} ${center} ${center})`}
        />
      )}
    </svg>
  );
}

const contextWidth = 320;
const usageWidth = 300;

/**
 * 上下文占用：只有圆环（百分比和已用/总量在悬停提示和构成里），点开是上下文构成（children，浮层开着时才挂载）。
 * 给了 task（任务里）且会话里已有回复时，浮层左边一直带着按模型的本会话用量（右边的构成不动）；还没有回复时浮层是单栏。
 */
function ContextButton({
  context,
  task,
  children,
}: {
  context: NonNullable<TaskState["contextUsage"]>;
  task?: TaskState;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const usage = useModelUsage(task, open);
  // 斜杠命令 /context：打开上下文构成。
  useEffect(() => onStudioCommand((command) => command === "context" && setOpen(true)), []);
  const close = () => setOpen(false);
  const label = t("composer.context", { p: formatPercent(context.percent) });
  const expanded = task !== undefined && hasModelUsage(usage);
  // omp 的自动压缩触发点（输入框卡片的 meter 里读到的生效值）；圆环上画一道刻度。
  const autoAt = task?.contextCompaction?.autoAtPercent ?? null;
  return (
    <div className="ui-popover-anchor usage-context-anchor">
      <button
        type="button"
        className="usage-context"
        data-high={context.percent >= 90 || undefined}
        data-testid="context-meter"
        aria-label={label}
        title={`${label} · ${t("composer.usage.context", {
          used: formatCount(context.tokens),
          total: formatCount(context.contextWindow),
        })}${autoAt === null ? "" : `\n${t("board.ctxAutoAt", { p: Math.round(autoAt) })}`}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Ring percent={context.percent} autoAt={autoAt} />
      </button>
      <Popover
        open={open}
        onClose={close}
        width={expanded ? contextWidth + usageWidth : contextWidth}
        align="end"
        label={label}
      >
        <div className="ctx-pop" data-expanded={expanded || undefined}>
          {expanded && task !== undefined && (
            <div className="ctx-pop-aside" data-testid="session-usage">
              <ModelBreakdown task={task} load={usage} />
            </div>
          )}
          <div className="ctx-pop-main">{children}</div>
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
    <ContextButton context={context} task={task}>
      <TaskContextBreakdown key={task.id} taskId={task.id} context={context} task={task} />
    </ContextButton>
  );
}

/** 新任务草稿的上下文圆环：还没有会话，占用是 0，窗口取所选模型的；模型还没读到或没报窗口时是占位圆环。 */
export function DraftContextMeter({ model, projectId }: { model: ModelOption | null; projectId: ProjectId | null }) {
  const window = model?.contextWindow ?? null;
  useEffect(() => prefetchCompaction(projectId), [projectId]);
  if (window === null || window <= 0) return <ContextPlaceholder />;
  return (
    <ContextButton context={{ tokens: 0, contextWindow: window, percent: 0 }}>
      <DraftContextBreakdown window={window} modelKey={model?.key ?? null} projectId={projectId} />
    </ContextButton>
  );
}

/**
 * 工具行里模型/审批胶囊右边的速度：有 omp 的实时速度（输入框卡片里的 `omp.composer.rate`，只在 omp 设置 `composer.tokenRate` 开着时有，
 * shared/tsp/composer-facts.ts）就用它（取整，避免每秒十几次数字乱跳）；没有就取会话文件里最近一条回复的
 * （`useSessionExtras().tokensPerSecond`，output ÷ (duration − ttft)，一轮结束时刷新）。运行中才显示，空闲时不显示。
 */
export function UsageMeter({ task }: { task: TaskState }) {
  const t = useT();
  const tokensPerSecond = useSessionExtras(task.id, (extras) => extras.tokensPerSecond);
  const liveRate = useTspDerived(task.id, deriveComposerFacts, sameComposerFacts)?.rate ?? null;
  const busy = task.status === "running" || task.status === "needs_you";
  const speedText = !busy
    ? null
    : liveRate !== null
      ? String(Math.max(1, Math.round(liveRate)))
      : formatTokensPerSecond(tokensPerSecond);
  if (speedText === null) return null;
  return (
    <div className="usage" role="group" aria-label={t("composer.usage.aria")} data-testid="usage-meter">
      <span className="usage-item usage-tps" data-testid="usage-tps" data-live={liveRate !== null || undefined}>
        {t("composer.usage.tps", { n: speedText })}
      </span>
    </div>
  );
}
