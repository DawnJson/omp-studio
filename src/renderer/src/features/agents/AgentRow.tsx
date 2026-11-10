// 列表里的一行：状态点、名字、类型（只在不是默认的 task 时显示）和 `后台` 标签、右端用时 + 状态（运行中有完成度估计时换成进度环 + 百分比）；
// 第二行是正在用的工具和意图（运行中）或任务说明（去掉 Markdown 标题的 #）。token 和费用在详情里。
// 点行 = 选中它、下方显示详情（同 omp Hub 里移动光标）；进入它的对话用详情头部的"进入对话"按钮。
import { useRef } from "react";
import { isAgentActive, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { formatElapsed } from "../tsp/fmt.ts";
import { useAge } from "../tsp/use-clock.ts";
import { agentContextPercent, agentElapsed, agentProgress, cleanTask, dotStatus, statusKey } from "./agent-model.ts";

const RING = 2 * Math.PI * 5.5;

export function AgentRow({ agent, selected, onSelect }: { agent: HubAgent; selected: boolean; onSelect(): void }) {
  const t = useT();
  // 两次工具调用之间 omp 发 tool: null：运行中接着显示上一个工具，不在工具和任务说明之间来回换（2026-11-09 仓库所有者：行一直闪）。
  const lastTool = useRef(agent.tool);
  if (agent.tool !== null || !isAgentActive(agent.status)) lastTool.current = agent.tool;
  const tool = lastTool.current;
  const line = tool
    ? t("agents.usingTool", { tool: tool.name, intent: tool.intent || cleanTask(agent.task) })
    : cleanTask(agent.task);
  const progress = agentProgress(agent);
  const context = agentContextPercent(agent);
  // 运行中 omp 给的 age 是到达时的已用时间，本地接着走（TSP 规范：正的 age 才加上到达后的时间）；结束后是 took。
  // 旧版 omp（18.12.x 的录制）运行中 stats.age 一直是 0：不走，照 omp 给的显示。
  const elapsed = agentElapsed(agent);
  const ticking = useAge(
    elapsed ?? undefined,
    elapsed !== null && elapsed > 0 && agent.stats.took === null && isAgentActive(agent.status),
    "seconds",
  );
  return (
    <li className="agents-item" data-current={selected ? "true" : undefined}>
      <button
        type="button"
        className="agents-row"
        data-testid="agents-row"
        data-name={agent.name}
        data-status={agent.status}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="agents-dot" data-status={dotStatus(agent.status)} aria-hidden="true" />
        <span className="agents-row-main">
          <span className="agents-row-head">
            <span className="agents-row-name" title={agent.name}>
              {agent.name}
            </span>
            {agent.agent !== null && agent.agent !== "task" && <span className="agents-chip">{agent.agent}</span>}
            {agent.background && <span className="agents-chip">{t("agents.background")}</span>}
            {context !== null && (
              <span
                className="agents-ctx"
                data-testid="agents-row-ctx"
                data-percent={context}
                data-high={context >= 90 || undefined}
                title={
                  agent.stats.contextLabel === null
                    ? t("agents.contextTitle", { percent: context })
                    : t("agents.contextTitleLabel", { percent: context, label: agent.stats.contextLabel })
                }
              >
                <span className="agents-ctx-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(context > 0 ? 4 : 0, context)}%` }} />
                </span>
                {context}%
              </span>
            )}
            {elapsed !== null && (
              <span className="agents-row-time" data-testid="agents-row-time" title={t("agents.time")} role="timer">
                {formatElapsed(ticking, "seconds")}
              </span>
            )}
            {progress === null ? (
              <span className="agents-row-status" data-status={agent.status}>
                {t(statusKey(agent.status))}
              </span>
            ) : (
              <span
                className="agents-row-status agents-progress"
                data-status={agent.status}
                data-testid="agents-row-progress"
                title={t("agents.progressTitle", { percent: progress })}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle className="tr" cx="8" cy="8" r="5.5" />
                  <circle className="fl" cx="8" cy="8" r="5.5" strokeDasharray={`${(progress / 100) * RING} ${RING}`} />
                </svg>
                {progress}%
              </span>
            )}
          </span>
          {line !== "" && (
            <span className="agents-row-line" title={line}>
              {line}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
