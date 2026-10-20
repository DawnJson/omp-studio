// 子代理表的纯函数：行顺序、归到哪一轮（并保持引用稳定）、每行用时、表头合计。
import { describe, expect, it } from "vitest";
import type { SubagentLane } from "../src/shared/subagents.ts";
import type { Turn } from "../src/renderer/src/features/conversation/model.ts";
import {
  assignLanesToTurns,
  laneElapsed,
  laneTotals,
  orderLanes,
} from "../src/renderer/src/features/lanes/lane-model.ts";

const lane = (id: string, startedAt: number, extra: Partial<SubagentLane> = {}): SubagentLane => ({
  id,
  parentId: null,
  rev: 0,
  agent: "task",
  description: null,
  task: null,
  assignment: null,
  detached: true,
  status: "completed",
  startedAt,
  endedAt: startedAt + 1000,
  model: null,
  thinkingLevel: null,
  modelIsFallback: false,
  lastIntent: null,
  toolCount: 0,
  requests: 0,
  tokens: 0,
  cost: 0,
  durationMs: null,
  contextTokens: null,
  contextWindow: null,
  tools: [],
  touched: [],
  ...extra,
});

const turn = (key: string, startedAt: number, endedAt: number, steps: Turn["steps"] = []): Turn =>
  ({ key, startedAt, endedAt, steps }) as unknown as Turn;

describe("orderLanes", () => {
  it("父在前，子紧跟其后并缩进；父不存在的当顶层；同级按开始时间", () => {
    const rows = orderLanes([
      lane("B", 20),
      lane("A.child", 15, { parentId: "A" }),
      lane("A", 10),
      lane("orphan", 5, { parentId: "gone" }),
    ]);
    expect(rows.map((r) => `${r.depth}:${r.lane.id}`)).toEqual(["0:orphan", "0:A", "1:A.child", "0:B"]);
  });
});

describe("assignLanesToTurns", () => {
  const turns = [turn("t1", 100, 200), turn("t2", 300, 400)];
  it("归到开始时间不晚于它的最后一轮；第一轮之前的归第一轮；没有子代理的轮不出现", () => {
    const map = assignLanesToTurns(turns, [lane("early", 50), lane("a", 150), lane("late", 450)]);
    expect([...map.keys()]).toEqual(["t1", "t2"]);
    expect(map.get("t1")?.map((l) => l.id)).toEqual(["early", "a"]);
    expect(map.get("t2")?.map((l) => l.id)).toEqual(["late"]);
    expect(assignLanesToTurns(turns, [lane("a", 150)]).has("t2")).toBe(false);
  });
  it("内容没变的数组沿用旧引用", () => {
    const a = lane("a", 150);
    const b = lane("b", 350);
    const first = assignLanesToTurns(turns, [a, b]);
    const second = assignLanesToTurns(turns, [a, lane("b", 350, { rev: 1 })], first);
    expect(second.get("t1")).toBe(first.get("t1"));
    expect(second.get("t2")).not.toBe(first.get("t2"));
  });
  it("没有轮时什么也不分", () => {
    expect(assignLanesToTurns([], [lane("a", 1)]).size).toBe(0);
  });
});

describe("laneElapsed", () => {
  it("结束了用 omp 报的 durationMs，没有就用起止", () => {
    expect(laneElapsed(lane("a", 1000, { endedAt: 9000, durationMs: 7500 }), 99_999)).toBe(7500);
    expect(laneElapsed(lane("a", 1000, { endedAt: 4000 }), 99_999)).toBe(3000);
  });
  it("还在跑的取到现在，omp 报得更大时不倒退", () => {
    const running = { status: "running", endedAt: null } as const;
    expect(laneElapsed(lane("a", 1000, { ...running, durationMs: 2000 }), 6000)).toBe(5000);
    expect(laneElapsed(lane("a", 1000, { ...running, durationMs: 8000 }), 6000)).toBe(8000);
  });
});

describe("laneTotals", () => {
  it("费用、用时、请求、token 求和（用时是各自之和，不是墙钟）", () => {
    const totals = laneTotals(
      [
        lane("a", 0, { endedAt: 4000, cost: 0.002, requests: 3, tokens: 1500 }),
        lane("b", 1000, { endedAt: 3000, cost: 0.0005, requests: 2, tokens: 700 }),
      ],
      10_000,
    );
    expect(totals).toEqual({ cost: 0.0025, elapsed: 6000, requests: 5, tokens: 2200 });
  });
});
