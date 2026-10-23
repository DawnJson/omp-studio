// 列表里的一行：状态点、名字、类型（只在不是默认的 task 时显示）和 `后台` 标签、右端状态（运行中有完成度估计时换成进度环 + 百分比）；
// 第二行是正在用的工具和意图（运行中）或任务说明（去掉 Markdown 标题的 #）。token 和费用在详情里。
// 点行 = 进入这个子代理的对话（同 omp Hub 的 Enter / 点击，能聚焦的状态）；行右端的"详情"按钮 = 看详情（已完成 / 失败的整行就是进详情）。
import type { HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { agentContextPercent, agentProgress, canFocus, cleanTask, dotStatus, statusKey } from "./agent-model.ts";

const RING = 2 * Math.PI * 5.5;

export function AgentRow({
  agent,
  selected,
  busy,
  onSelect,
  onFocus,
}: {
  agent: HubAgent;
  selected: boolean;
  busy: boolean;
  onSelect(): void;
  onFocus(): void;
}) {
  const t = useT();
  const line = agent.tool
    ? t("agents.usingTool", { tool: agent.tool.name, intent: agent.tool.intent || cleanTask(agent.task) })
    : cleanTask(agent.task);
  const progress = agentProgress(agent);
  const context = agentContextPercent(agent);
  const focusable = canFocus(agent.status);
  return (
    <li className="agents-item" data-current={selected ? "true" : undefined}>
      <button
        type="button"
        className="agents-row"
        data-testid="agents-row"
        data-name={agent.name}
        data-status={agent.status}
        data-focusable={focusable ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
        title={focusable ? t("agents.focusTitle", { name: agent.name }) : undefined}
        disabled={focusable && busy}
        onClick={focusable ? onFocus : onSelect}
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
      {focusable && (
        <IconButton
          label={t("agents.detailsOf", { name: agent.name })}
          tip={t("agents.details")}
          testId="agents-row-details"
          className="agents-row-details"
          onClick={onSelect}
        >
          <ChevronRight size={14} />
        </IconButton>
      )}
    </li>
  );
}
