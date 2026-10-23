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

/** 状态点样式（agents.css 的 .agents-dot）：运行 / 等待 = 呼吸点，失败 = 红，被结束 = 虚线，其余 = 空心。 */
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

/** 能进入对话（omp 的 Hub 里 Enter / 点击 = 聚焦；parked / 被结束的先复活）。pending 的 omp 的 Hub 还没有这一行（实测），已完成 / 失败的也只看详情。 */
export function canFocus(status: AgentStatus): boolean {
  return status === "running" || status === "idle" || status === "parked" || status === "aborted";
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

/** 完成度百分比（0–100 的整数）：只在运行中、omp 给了估计时有，其余为 null（和 omp 一样，结束后不再显示）。 */
export function agentProgress(agent: HubAgent): number | null {
  if (agent.status !== "running" || agent.stats.done === null) return null;
  return Math.round(Math.min(1, Math.max(0, agent.stats.done)) * 100);
}

/** 上下文占用百分比（0–100 的整数，omp Hub 的 Ctx 列）；omp 没给为 null。 */
export function agentContextPercent(agent: HubAgent): number | null {
  return agent.stats.context === null ? null : Math.round(agent.stats.context * 100);
}

/** 任务说明去掉 Markdown 标题的 #：omp 的 `agent` 节点里任务说明的换行被压成了空格（`# Target … # Change 1. …`），
 *  标题符号夹在句中，原样显示就是一串 #。 */
export function cleanTask(task: string): string {
  return task.replace(/(^|\s)#{1,6}\s+/g, "$1").trim();
}
