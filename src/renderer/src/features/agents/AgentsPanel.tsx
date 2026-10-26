// 右栏的子代理面板（spec §4.28，TSP 任务；和文件面板同一栏，同时只开一个）：列表（点行 = 选中）→ 详情（列表下方，"进入对话"在它头部）→ 插话框（钉在面板底边）。
// 列表直接从 TSP 文档推导（listAgents），所以随 omp 的帧实时更新；插话 / 结束 / 恢复由主进程在后台驱动 omp 的 Agent Hub，
// 期间面板顶部显示"正在发给 <名字>"，omp 的 Hub 不画出来。
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { focusedAgentName, listAgents, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { IconButton, Tabs, tabPanelProps } from "../../ui/controls.tsx";
import { setPreviewWidth, usePreviewWidth } from "../file-preview/preview-store.ts";
import { useTspDerived, useTspDrive } from "../tsp/tsp-store.ts";
import { AgentDetail } from "./AgentDetail.tsx";
import { AgentsActivity } from "./AgentsActivity.tsx";
import { AgentRow } from "./AgentRow.tsx";
import { canSteer, sameAgents, sortAgents } from "./agent-model.ts";
import { closeAgentsPanel, selectAgent } from "./agents-store.ts";
import { SteerBox } from "./SteerBox.tsx";
import "../file-preview/file-preview.css";
import "./agents.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;
const NO_AGENTS: readonly HubAgent[] = [];

const DRIVING_KEY = {
  focus: "agents.focusing",
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
  // omp 聚焦在某个子代理上时，主界面画的是它的会话，文档里没有 agent 节点，列表是空的（实测 hub-steer 录制）。
  const focusedAgent = useTspDerived(taskId, focusedAgentName, Object.is);
  const agents = useMemo(() => sortAgents(derived), [derived]);
  const driving = useTspDrive(taskId);
  const drive = driving?.kind === "hub" ? driving : null;
  // 没选过就看列表第一个（同 omp 的 Agent Hub：打开时总有一个选中项、详情直接显示）。
  const current = agents.find((agent) => agent.name === selected) ?? agents[0] ?? null;
  const [tab, setTab] = useState<"agents" | "activity">("agents");

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
        <span className="file-preview-spacer" />
        <IconButton label={t("agents.close")} testId="agents-close" onClick={() => closeAgentsPanel()}>
          <Close size={14} />
        </IconButton>
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
        </div>
      )}

      <div className="agents-tabs">
        <Tabs<"agents" | "activity">
          label={t("agents.tabsLabel")}
          idBase={`agents-${taskId}`}
          testId="agents-tabs"
          value={tab}
          tabs={[
            { id: "agents", label: t("agents.tabAgents"), count: agents.length },
            { id: "activity", label: t("agents.tabActivity") },
          ]}
          onChange={setTab}
        />
      </div>

      <div className="agents-body" {...tabPanelProps(`agents-${taskId}`, tab)}>
        {tab === "activity" ? (
          <AgentsActivity
            taskId={taskId}
            agents={agents}
            onOpenAgent={(name) => {
              selectAgent(name);
              setTab("agents");
            }}
          />
        ) : agents.length === 0 ? (
          <p className="agents-muted agents-empty" data-testid="agents-empty">
            {focusedAgent !== null ? t("agents.focusedEmpty", { name: focusedAgent }) : t("agents.empty")}
          </p>
        ) : (
          <ul className="agents-list" aria-label={t("agents.listLabel")} data-testid="agents-list">
            {agents.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                selected={agent === current}
                onSelect={() => selectAgent(agent.name)}
              />
            ))}
          </ul>
        )}
        {tab === "agents" && current !== null && (
          <AgentDetail key={current.name} taskId={taskId} agent={current} busy={drive !== null} />
        )}
      </div>
      {tab === "agents" && current !== null && canSteer(current.status) && (
        <SteerBox key={current.name} taskId={taskId} name={current.name} busy={drive !== null} />
      )}
    </section>
  );
}
