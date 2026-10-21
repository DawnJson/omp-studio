// 子代理面板的纯展示逻辑：状态的显示映射、列表比较、哪些操作可用。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { isAgentActive, type AgentStatus, type HubAgent } from "../../../../shared/tsp/agent-hub.ts";

const STATUS_KEY: Record<AgentStatus, MessageKey> = {
  pending: "agents.statusPending",
  running: "agents.statusRunning",
  done: "agents.statusDone",
  failed: "agents.statusFailed",
  aborted: "agents.statusAborted",
  idle: "agents.statusIdle",
  parked: "agents.statusParked",
};

export const statusKey = (status: AgentStatus): MessageKey => STATUS_KEY[status];

/** 复用泳道的状态点样式（lanes.css）：运行 / 等待 = 呼吸点，失败 = 红，被结束 = 虚线，其余 = 空心。 */
export function dotStatus(status: AgentStatus): "running" | "failed" | "aborted" | "completed" {
  if (status === "running" || status === "pending") return "running";
  if (status === "failed") return "failed";
  if (status === "aborted") return "aborted";
  return "completed";
}

/** 列表里的排序：运行中的在前，其余保持文档里的顺序。 */
export function sortAgents(agents: readonly HubAgent[]): HubAgent[] {
  return [...agents].sort((a, b) => Number(isAgentActive(b.status)) - Number(isAgentActive(a.status)));
}

export function sameAgents(a: readonly HubAgent[], b: readonly HubAgent[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 能插话：还在跑、空闲或挂起（实测过运行中的；已完成 / 被结束 / 失败的 omp 的 Hub 不一定能聚焦，不提供）。 */
export function canSteer(status: AgentStatus): boolean {
  return status === "pending" || status === "running" || status === "idle" || status === "parked";
}

/** 能结束：还在跑。 */
export const canKill = isAgentActive;

/** 能恢复：被结束或挂起（omp 自己的规则："Only parked or killed agents can be revived"）。 */
export function canRevive(status: AgentStatus): boolean {
  return status === "aborted" || status === "parked";
}

/** 运行中的已用时间 / 结束后的总时间（毫秒）；都没有为 null。 */
export function agentElapsed(agent: HubAgent): number | null {
  return agent.stats.took ?? agent.stats.age;
}
