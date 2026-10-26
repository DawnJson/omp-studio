// 列表里的一行：状态点、名字、类型（只在不是默认的 task 时显示）和 `后台` 标签、右端状态（运行中有完成度估计时换成进度环 + 百分比）；
// 第二行是正在用的工具和意图（运行中）或任务说明（去掉 Markdown 标题的 #）。token 和费用在详情里。
// 点行 = 选中它、下方显示详情（同 omp Hub 里移动光标）；进入它的对话用详情头部的"进入对话"按钮。
import type { HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { agentContextPercent, agentProgress, cleanTask, dotStatus, statusKey } from "./agent-model.ts";

const RING = 2 * Math.PI * 5.5;

export function AgentRow({ agent, selected, onSelect }: { agent: HubAgent; selected: boolean; onSelect(): void }) {
  const t = useT();
  const line = agent.tool
    ? t("agents.usingTool", { tool: agent.tool.name, intent: agent.tool.intent || cleanTask(agent.task) })
    : cleanTask(agent.task);
  const progress = agentProgress(agent);
  const context = agentContextPercent(agent);
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
