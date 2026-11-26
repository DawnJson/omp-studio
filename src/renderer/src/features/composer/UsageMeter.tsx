// 输入框下方状态行右端的上下文条（ComposerStatus.tsx）：细横条 + 百分比，点开弹出上下文构成；
// 任务里有回复后，构成左边一直带着按模型的本会话用量（ModelBreakdown）。
import { useEffect, useState, type ReactNode } from "react";
import type { ModelOption, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { DraftContextBreakdown, prefetchCompaction, TaskContextBreakdown } from "./ContextBreakdown.tsx";
import { hasModelUsage, ModelBreakdown, useModelUsage } from "./ModelBreakdown.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { FlipText } from "../../ui/FlipText.tsx";
import { onStudioCommand } from "../palette/studio-command.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

/** 横条：底 + 已用；`autoAt`（0–100）是自动压缩触发点，从它到末尾画一段斜条纹（预留），已用压在它上面。 */
function Bar({ percent, autoAt = null }: { percent: number; autoAt?: number | null }) {
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  return (
    <span className="usage-bar" aria-hidden="true">
      {autoAt !== null && (
        <span
          className="usage-bar-reserve"
          data-testid="context-reserve"
          data-at={autoAt}
          style={{ width: `${100 - clamp(autoAt)}%` }}
        />
      )}
      <span className="usage-bar-fill" style={{ width: `${clamp(percent)}%` }} />
    </span>
  );
}

const contextWidth = 320;
const usageWidth = 300;

/**
 * 上下文占用：横条 + 百分比（已用/总量在悬停提示和构成里），点开是上下文构成（children，浮层开着时才挂载）。
 * 给了 task（任务里）且会话里已有回复时，浮层左边一直带着本会话用量（右边的构成不动）；否则浮层是单栏。
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
        <Bar percent={context.percent} autoAt={autoAt} />
        <FlipText className="usage-context-pct" value={`${formatPercent(context.percent)}%`} />
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

/** 还没有上下文数据时的占位：同一位置、同样大小的空条，不能点；数据到了换成可点的。 */
function ContextPlaceholder() {
  return (
    <span className="usage-context-anchor" aria-hidden="true">
      <span className="usage-context" data-pending data-testid="context-meter-pending">
        <Bar percent={0} />
        <span className="usage-context-pct">0%</span>
      </span>
    </span>
  );
}

/** 任务的上下文条；omp 还没给出上下文占用时是占位。 */
export function ContextMeter({ task }: { task: TaskState }) {
  const context = task.contextUsage;
  if (context === null) return <ContextPlaceholder />;
  return (
    <ContextButton context={context} task={task}>
      <TaskContextBreakdown key={task.id} taskId={task.id} context={context} task={task} />
    </ContextButton>
  );
}

/** 新任务草稿的上下文条：还没有会话，占用是 0，窗口取所选模型的；模型还没读到或没报窗口时是占位。 */
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
