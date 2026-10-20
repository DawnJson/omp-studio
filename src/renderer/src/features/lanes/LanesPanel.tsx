// 子代理表（spec 4.11 展开区顶部），照 Tern 里 omp 的 Agents：表头是合计（费用 · 用时 · 请求 · token），
// 每个子代理一行：状态点、名字、模型、任务，右边 Cost / Time / Req / Tools / Tok / Ctx 六列数字；点一行在下方展开详情。
// 文案是运行过程的英文（shared/i18n/run/），两种界面一样。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight, Users } from "../../icons.tsx";
import { formatElapsed, formatTokenCount } from "../conversation/tool-view.ts";
import { useNow } from "../conversation/use-now.ts";
import { laneElapsed, laneTotals, orderLanes } from "./lane-model.ts";
import { formatCost, shortModel, statusLabel } from "./format.ts";
import { SubagentDetailPanel } from "./SubagentDetailPanel.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import "./lanes.css";

const COLUMNS = ["cost", "time", "req", "tools", "tok", "ctx"] as const;

function ContextCell({ lane, t }: { lane: SubagentLane; t: TFunction }) {
  const { contextTokens: used, contextWindow: limit } = lane;
  if (used === null || limit === null || limit <= 0) {
    return <span className="agent-ctx" aria-hidden="true" />;
  }
  const percent = Math.min(100, (used / limit) * 100);
  return (
    <span
      className="agent-ctx"
      title={t("process.agentsContext", {
        used: formatTokenCount(used),
        window: formatTokenCount(limit),
        percent: Math.round(percent),
      })}
    >
      <span className="agent-ctx-fill" style={{ width: `${Math.max(percent, 4)}%` }} />
    </span>
  );
}

export function LanesPanel({
  taskId,
  lanes,
  live,
  projectPath,
}: {
  taskId: TaskId;
  lanes: readonly SubagentLane[];
  /** 这一轮还在跑：用时跟着现在走。 */
  live: boolean;
  projectPath: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const running = lanes.some((lane) => lane.status === "running");
  const now = useNow(live || running);
  const rows = orderLanes(lanes);
  const totals = laneTotals(lanes, now);
  const selectedLane = selected === null ? null : (lanes.find((lane) => lane.id === selected) ?? null);

  return (
    <section className="lanes" data-testid="lanes">
      <button
        type="button"
        className="lanes-head"
        aria-expanded={open}
        data-testid="lanes-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={14} className="process-chevron" data-open={open || undefined} />
        <Users size={14} className="lanes-icon" />
        <span className="lanes-title">{t("process.agents")}</span>
        <span className="lanes-totals" data-testid="lanes-totals">
          {t("process.agentsTotals", {
            cost: formatCost(totals.cost),
            time: formatElapsed(totals.elapsed),
            requests: totals.requests,
            tokens: formatTokenCount(totals.tokens),
          })}
        </span>
      </button>
      <Reveal open={open}>
        <div className="lanes-body">
          <div className="agent-row agent-cols" aria-hidden="true">
            <span />
            {COLUMNS.map((column) => (
              <span key={column} className="agent-num">
                {t(`process.agents.${column}`)}
              </span>
            ))}
          </div>
          {rows.map(({ lane, depth }) => {
            const task = lane.task ?? lane.description ?? null;
            const model = lane.model === null ? null : shortModel(lane.model);
            const status = statusLabel(t, lane.status);
            return (
              <button
                key={lane.id}
                type="button"
                className="agent-row"
                data-testid="lane-row"
                data-lane={lane.id}
                data-status={lane.status}
                data-selected={lane.id === selected || undefined}
                aria-pressed={lane.id === selected}
                aria-label={`${t("lanes.open", { name: lane.id })} · ${status}`}
                onClick={() => setSelected((current) => (current === lane.id ? null : lane.id))}
              >
                <span className="agent-main" style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}>
                  <span className="lane-dot" data-status={lane.status} title={status} />
                  <span className="agent-name">{lane.id}</span>
                  {model !== null && (
                    <span
                      className="agent-model"
                      data-fallback={lane.modelIsFallback || undefined}
                      title={[lane.model, lane.thinkingLevel, lane.modelIsFallback ? t("lanes.fallback") : null]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {model}
                    </span>
                  )}
                  {task !== null && (
                    <span className="agent-task" title={task}>
                      {task}
                    </span>
                  )}
                </span>
                <span className="agent-num">{formatCost(lane.cost)}</span>
                <span className="agent-num">{formatElapsed(laneElapsed(lane, now))}</span>
                <span className="agent-num">{lane.requests}</span>
                <span className="agent-num">{lane.toolCount}</span>
                <span className="agent-num" title={lane.tokens.toLocaleString("en-US")}>
                  {formatTokenCount(lane.tokens)}
                </span>
                <ContextCell lane={lane} t={t} />
              </button>
            );
          })}
          {selectedLane !== null && (
            <SubagentDetailPanel
              taskId={taskId}
              lane={selectedLane}
              projectPath={projectPath}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </Reveal>
    </section>
  );
}
