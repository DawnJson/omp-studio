// 子代理面板的展示规则（features/agents/agent-model.ts）：哪些状态能插话 / 结束 / 恢复、排序、状态点映射。
import { describe, expect, it } from "vitest";
import type { HubAgent } from "../src/shared/tsp/agent-hub.ts";
import {
  agentElapsed,
  canKill,
  canRevive,
  canSteer,
  dotStatus,
  sameAgents,
  sortAgents,
} from "../src/renderer/src/features/agents/agent-model.ts";

const agent = (name: string, status: HubAgent["status"], stats: Partial<HubAgent["stats"]> = {}): HubAgent => ({
  name,
  agent: "task",
  task: "",
  assignment: null,
  status,
  model: null,
  tool: null,
  stats: { tools: null, requests: null, tokens: null, contextLabel: null, cost: null, age: null, took: null, ...stats },
  background: true,
  depth: 0,
});

describe("子代理面板的操作规则", () => {
  it("插话：运行 / 等待 / 空闲 / 挂起；结束：运行 / 等待；恢复：被结束 / 挂起（omp 自己的规则）", () => {
    expect(["pending", "running", "idle", "parked"].every((status) => canSteer(status as HubAgent["status"]))).toBe(
      true,
    );
    expect(["done", "failed", "aborted"].some((status) => canSteer(status as HubAgent["status"]))).toBe(false);
    expect(canKill("running")).toBe(true);
    expect(canKill("pending")).toBe(true);
    expect(canKill("done")).toBe(false);
    expect(canKill("aborted")).toBe(false);
    expect(canRevive("aborted")).toBe(true);
    expect(canRevive("parked")).toBe(true);
    expect(canRevive("running")).toBe(false);
    expect(canRevive("done")).toBe(false);
  });

  it("运行中的排前面，同类保持原来的顺序", () => {
    const sorted = sortAgents([
      agent("A", "done"),
      agent("B", "running"),
      agent("C", "aborted"),
      agent("D", "pending"),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["B", "D", "A", "C"]);
  });

  it("状态点复用泳道样式；用时取结束总用时，没有取已用时间", () => {
    expect(dotStatus("running")).toBe("running");
    expect(dotStatus("pending")).toBe("running");
    expect(dotStatus("failed")).toBe("failed");
    expect(dotStatus("aborted")).toBe("aborted");
    expect(dotStatus("done")).toBe("completed");
    expect(agentElapsed(agent("A", "done", { took: 5000, age: 1 }))).toBe(5000);
    expect(agentElapsed(agent("A", "running", { age: 1200 }))).toBe(1200);
    expect(agentElapsed(agent("A", "running"))).toBeNull();
  });

  it("sameAgents 按内容比较（IPC 之外的文档推导每次产生新对象）", () => {
    expect(sameAgents([agent("A", "running")], [agent("A", "running")])).toBe(true);
    expect(sameAgents([agent("A", "running")], [agent("A", "done")])).toBe(false);
  });
});
