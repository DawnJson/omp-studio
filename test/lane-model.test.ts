// 泳道的纯函数：行顺序、归到哪一轮（并保持引用稳定）、时间轴范围、主代理工具节奏。
import { describe, expect, it } from "vitest";
import type { SubagentLane } from "../src/shared/subagents.ts";
import type { Turn } from "../src/renderer/src/features/conversation/model.ts";
import {
  assignLanesToTurns,
  mainToolMarks,
  orderLanes,
  percentAt,
  timelineSpan,
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

describe("timelineSpan / percentAt", () => {
  it("取本轮开始到最晚的结束；运行中的子代理取现在；至少 1 秒", () => {
    const t = turn("t", 1000, 5000);
    expect(timelineSpan(t, [lane("a", 1200, { endedAt: 9000 })], 6000, false)).toEqual({ start: 1000, end: 9000 });
    expect(timelineSpan(t, [lane("a", 1200, { endedAt: null, status: "running" })], 12_000, false).end).toBe(12_000);
    expect(timelineSpan(turn("t", 1000, 1000), [], 1000, false)).toEqual({ start: 1000, end: 2000 });
    expect(timelineSpan(t, [], 8000, true).end).toBe(8000);
  });
  it("位置夹在 0–100", () => {
    const span = { start: 1000, end: 2000 };
    expect(percentAt(span, 1500)).toBe(50);
    expect(percentAt(span, 0)).toBe(0);
    expect(percentAt(span, 9999)).toBe(100);
  });
});

describe("mainToolMarks", () => {
  it("只取有开始时间的工具；失败的标出来", () => {
    const step = (startedAt: number | null, endedAt: number | null, status: string) =>
      ({ kind: "tool", startedAt, endedAt, status }) as never;
    const marks = mainToolMarks(
      turn("t", 0, 10, [
        step(1, 2, "done"),
        step(null, null, "done"),
        step(3, 4, "error"),
        { kind: "narration", key: "n", text: "x" },
        step(5, null, "running"),
      ]),
    );
    expect(marks).toEqual([
      { start: 1, end: 2, failed: false },
      { start: 3, end: 4, failed: true },
      { start: 5, end: 5, failed: false },
    ]);
  });
});
