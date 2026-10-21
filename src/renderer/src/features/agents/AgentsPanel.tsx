// 右栏的子代理面板（spec §4.28，TSP 任务；和文件面板同一栏，同时只开一个）：列表 → 详情 → 插话框。
// 列表直接从 TSP 文档推导（listAgents），所以随 omp 的帧实时更新；插话 / 结束 / 恢复由主进程在后台驱动 omp 的 Agent Hub，
// 期间面板顶部显示"正在发给 <名字>"，omp 的 Hub 不画出来。
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { listAgents, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { setPreviewWidth, usePreviewWidth } from "../file-preview/preview-store.ts";
import { useTspDerived, useTspDrive } from "../tsp/tsp-store.ts";
import { AgentDetail } from "./AgentDetail.tsx";
import { AgentRow } from "./AgentRow.tsx";
import { sameAgents, sortAgents } from "./agent-model.ts";
import { closeAgentsPanel, selectAgent } from "./agents-store.ts";
import "../file-preview/file-preview.css";
import "../lanes/lanes.css";
import "./agents.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;
const NO_AGENTS: readonly HubAgent[] = [];

const DRIVING_KEY = {
  steer: "agents.steering",
  kill: "agents.killing",
  revive: "agents.reviving",
} as const;

export function AgentsPanel({ taskId, selected }: { taskId: TaskId; selected: string | null }) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
  const derived = useTspDerived(taskId, listAgents, sameAgents) ?? NO_AGENTS;
  const agents = useMemo(() => sortAgents(derived), [derived]);
  const drive = useTspDrive(taskId);
  const current = agents.find((agent) => agent.name === selected) ?? null;

  // 打开时把焦点放进面板：Esc 才关得掉它；关闭后由 store 还焦点。
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeAgentsPanel();
  };

  const clampWidth = (value: number) => {
    const parent = root.current?.parentElement;
    const max = parent ? parent.clientWidth * maxShare : value;
    return Math.max(minWidth, Math.min(max, value));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: root.current?.offsetWidth ?? minWidth };
  };
  // 向左拖 = 变宽。
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setPreviewWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
  };
  const onResizerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const now = root.current?.offsetWidth ?? minWidth;
    setPreviewWidth(clampWidth(now + (event.key === "ArrowLeft" ? keyboardStep : -keyboardStep)));
  };

  return (
    <section
      ref={root}
      className="file-preview agents-panel"
      data-testid="agents-panel"
      aria-label={t("agents.panelLabel")}
      tabIndex={-1}
      style={width === null ? undefined : { flexBasis: width }}
      onKeyDown={onKeyDown}
    >
      <div
        className="file-preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("agents.resize")}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={onResizerKey}
      />
      <header className="file-preview-head">
        <span className="agents-title">{t("agents.title")}</span>
        <span className="agents-count" data-testid="agents-count">
          {t("agents.count", { count: agents.length })}
        </span>
        <span className="file-preview-spacer" />
        <button
          type="button"
          className="icon-button file-preview-action"
          data-testid="agents-close"
          aria-label={t("agents.close")}
          title={t("agents.close")}
          onClick={() => closeAgentsPanel()}
        >
          <Close size={14} />
        </button>
      </header>

      {drive !== null && (
        <div
          className="agents-driving"
          role="status"
          data-testid="agents-driving"
          data-op={drive.op}
          data-name={drive.name}
        >
          <span className="agents-driving-dot" aria-hidden="true" />
          <span className="agents-driving-text">{t(DRIVING_KEY[drive.op], { name: drive.name })}</span>
          <span className="agents-driving-hint">{t("agents.drivingHint")}</span>
        </div>
      )}

      <div className="agents-body">
        {agents.length === 0 ? (
          <p className="lane-muted agents-empty" data-testid="agents-empty">
            {t("agents.empty")}
          </p>
        ) : (
          <ul className="agents-list" aria-label={t("agents.listLabel")} data-testid="agents-list">
            {agents.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                selected={agent.name === selected}
                onSelect={() => selectAgent(agent.name === selected ? null : agent.name)}
              />
            ))}
          </ul>
        )}
        {current !== null ? (
          <AgentDetail
            key={current.name}
            taskId={taskId}
            agent={current}
            busy={drive !== null}
            onClose={() => selectAgent(null)}
          />
        ) : (
          agents.length > 0 && <p className="lane-muted agents-pick">{t("agents.pick")}</p>
        )}
      </div>
    </section>
  );
}
