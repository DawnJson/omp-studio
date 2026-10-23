// Activity 页的数据：把每个子代理的记录（IPC getTspSubagentRecord，和详情里的"对话记录"同一份）合并成一条活动流（shared/tsp/agent-activity.ts）。
// 只重读"变了"的子代理：缓存键 = 状态 + 工具调用数（每多一次工具调用、运行 → 结束各读一次，同详情的记录）；消失的子代理从缓存里丢掉。
// 过期的响应（切了任务、又来了新一轮）丢弃；某个子代理读失败时跳过它、其余照常显示，下一轮变化时重试。
import { useEffect, useRef, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { AgentMessage } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { mergeActivity, type ActivityItem } from "../../../../shared/tsp/agent-activity.ts";

interface Cached {
  key: string;
  messages: AgentMessage[] | null;
}

export interface AgentsActivityState {
  items: ActivityItem[];
  /** 还没有读完第一遍。 */
  loading: boolean;
}

const cacheKey = (agent: HubAgent): string => `${agent.status}:${agent.stats.tools ?? 0}`;

/** `enabled` 为假（不在 Activity 页）时不读。 */
export function useAgentsActivity(taskId: TaskId, agents: readonly HubAgent[], enabled: boolean): AgentsActivityState {
  const [state, setState] = useState<AgentsActivityState>({ items: [], loading: true });
  const cache = useRef(new Map<string, Cached>());
  const owner = useRef<TaskId | null>(null);
  const latest = useRef(0);
  const signature = agents.map((agent) => `${agent.name}:${cacheKey(agent)}`).join("|");

  useEffect(() => {
    if (!enabled) return;
    if (owner.current !== taskId) {
      cache.current.clear();
      owner.current = taskId;
    }
    const request = ++latest.current;
    const names = new Set(agents.map((agent) => agent.name));
    for (const name of cache.current.keys()) if (!names.has(name)) cache.current.delete(name);
    const stale = agents.filter((agent) => cache.current.get(agent.name)?.key !== cacheKey(agent));
    const publish = () => {
      setState({
        items: mergeActivity(
          agents.map((agent) => ({ name: agent.name, messages: cache.current.get(agent.name)?.messages ?? null })),
        ),
        loading: false,
      });
    };
    if (stale.length === 0) {
      publish();
      return;
    }
    void Promise.all(
      stale.map(async (agent) => {
        try {
          const record = await window.studio.getTspSubagentRecord(taskId, agent.name);
          if (request === latest.current)
            cache.current.set(agent.name, { key: cacheKey(agent), messages: record.messages });
        } catch {
          // 这个子代理这一轮读不到：留着旧的（没有就没有），缓存键不更新，下次变化再试。
        }
      }),
    ).then(() => {
      if (request === latest.current) publish();
    });
    // signature 代表 agents 里和读取有关的全部内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, enabled, signature]);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  return state;
}
