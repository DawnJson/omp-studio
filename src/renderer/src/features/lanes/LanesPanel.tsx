// 泳道（spec 4.11 展开区顶部）：时间轴上一行主代理（工具节奏）+ 每个子代理一行（起止、状态、模型）；点一行在下方展开详情。
// 帧没有时间戳，所有时间都是主进程接收时间（docs/architecture/subagents.md）。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { SubagentLane } from "../../../../shared/subagents.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { formatDuration } from "../conversation/format.ts";
import type { Turn } from "../conversation/model.ts";
import { useNow } from "../conversation/use-now.ts";
import { mainToolMarks, orderLanes, percentAt, timelineSpan, type Span } from "./lane-model.ts";
import { modelLine, statusLabel } from "./format.ts";
import { SubagentDetailPanel } from "./SubagentDetailPanel.tsx";
import "./lanes.css";

function LaneBar({ lane, span, now }: { lane: SubagentLane; span: Span; now: number }) {
  const left = percentAt(span, lane.startedAt);
  const right = percentAt(span, lane.endedAt ?? now);
  return (
    <div className="lane-track">
      <div
        className="lane-bar"
        data-status={lane.status}
        style={{ left: `${left}%`, width: `max(${right - left}%, 4px)` }}
      />
      {lane.tools.map((tool, index) => (
        <span
          key={index}
          className="lane-tick"
          data-failed={tool.isError || undefined}
          style={{ left: `${percentAt(span, tool.at)}%` }}
          title={tool.intent ?? tool.tool}
        />
      ))}
    </div>
  );
}

export function LanesPanel({
  taskId,
  turn,
  lanes,
  live,
  projectPath,
}: {
  taskId: TaskId;
  turn: Turn;
  lanes: readonly SubagentLane[];
  /** 这一轮还在跑：时间轴的右端跟着现在走。 */
  live: boolean;
  projectPath: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const running = lanes.some((lane) => lane.status === "running");
  const now = useNow(live || running);
  const rows = orderLanes(lanes);
  const span = timelineSpan(turn, lanes, now, live);
  const marks = mainToolMarks(turn);
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
        <span className="lanes-title">{t("lanes.title")}</span>
        <span className="lanes-count">{t("process.subagents", { count: lanes.length })}</span>
      </button>
      {open && (
        <div className="lanes-body">
          <div className="lane-row" data-testid="lane-main">
            <div className="lane-label">
              <span className="lane-name">{t("lanes.main")}</span>
              <span className="lane-sub">{t("lanes.toolCount", { count: marks.length })}</span>
            </div>
            <div className="lane-track" title={t("lanes.mainTools")}>
              {marks.map((mark, index) => {
                const left = percentAt(span, mark.start);
                return (
                  <span
                    key={index}
                    className="lane-mark"
                    data-failed={mark.failed || undefined}
                    style={{ left: `${left}%`, width: `max(${percentAt(span, mark.end) - left}%, 2px)` }}
                  />
                );
              })}
            </div>
          </div>
          {rows.map(({ lane, depth }) => {
            const model = modelLine(lane);
            return (
              <button
                key={lane.id}
                type="button"
                className="lane-row lane-row-btn"
                data-testid="lane-row"
                data-lane={lane.id}
                data-status={lane.status}
                data-selected={lane.id === selected || undefined}
                aria-pressed={lane.id === selected}
                aria-label={t("lanes.open", { name: lane.id })}
                onClick={() => setSelected((current) => (current === lane.id ? null : lane.id))}
              >
                <div className="lane-label" style={{ paddingLeft: `${depth * 14}px` }}>
                  <span className="lane-name">
                    <span className="lane-dot" data-status={lane.status} aria-hidden="true" />
                    <span className="lane-name-text">{lane.id}</span>
                  </span>
                  <span className="lane-sub" title={lane.model ?? undefined}>
                    {statusLabel(t, lane.status)}
                    {model !== null && ` · ${model}`}
                  </span>
                </div>
                <LaneBar lane={lane} span={span} now={now} />
              </button>
            );
          })}
          <div className="lane-axis" aria-hidden="true">
            <span>0</span>
            <span>{formatDuration(t, span.end - span.start)}</span>
          </div>
          {selectedLane !== null && (
            <SubagentDetailPanel
              taskId={taskId}
              lane={selectedLane}
              projectPath={projectPath}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}
