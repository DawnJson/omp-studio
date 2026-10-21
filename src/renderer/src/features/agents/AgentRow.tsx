// 列表里的一行：状态点、名字、类型、当前工具和意图（运行中）或任务说明；token 和费用折进详情。
import type { HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { dotStatus, statusKey } from "./agent-model.ts";

export function AgentRow({ agent, selected, onSelect }: { agent: HubAgent; selected: boolean; onSelect(): void }) {
  const t = useT();
  const line = agent.tool
    ? t("agents.usingTool", { tool: agent.tool.name, intent: agent.tool.intent || agent.task })
    : agent.task;
  return (
    <li>
      <button
        type="button"
        className="agents-row"
        data-testid="agents-row"
        data-name={agent.name}
        data-status={agent.status}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="lane-dot" data-status={dotStatus(agent.status)} aria-hidden="true" />
        <span className="agents-row-main">
          <span className="agents-row-head">
            <span className="agents-row-name">{agent.name}</span>
            {agent.agent !== null && <span className="agents-chip">{agent.agent}</span>}
            {agent.background && <span className="agents-chip">{t("agents.background")}</span>}
            <span className="agents-row-status">{t(statusKey(agent.status))}</span>
          </span>
          {line !== "" && <span className="agents-row-line">{line}</span>}
        </span>
      </button>
    </li>
  );
}
