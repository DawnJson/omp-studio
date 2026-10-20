import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTurnCosts, turnCostsFromSession } from "../src/main/tsp/turn-costs.ts";

const assistant = (stopReason: string, total: number) =>
  JSON.stringify({ type: "message", message: { role: "assistant", stopReason, usage: { cost: { total } } } });
const user = () => JSON.stringify({ type: "message", message: { role: "user", content: "hi" } });
const toolResult = () => JSON.stringify({ type: "message", message: { role: "toolResult" } });

describe("turnCostsFromSession", () => {
  it("一轮里多次工具调用的费用相加", () => {
    const text = [
      user(),
      assistant("toolUse", 0.001),
      toolResult(),
      assistant("toolUse", 0.002),
      toolResult(),
      assistant("stop", 0.004),
    ].join("\n");
    expect(turnCostsFromSession(text)).toEqual([0.007]);
  });

  it("steer 插入的 user 消息不切轮，下一条 user 之后的回复另算一轮", () => {
    const text = [
      user(),
      assistant("toolUse", 0.001),
      user(),
      assistant("stop", 0.002),
      user(),
      assistant("stop", 0.5),
    ].join("\n");
    expect(turnCostsFromSession(text)).toEqual([0.003, 0.5]);
  });

  it("最后一轮还没结束不算", () => {
    const text = [user(), assistant("stop", 0.1), user(), assistant("toolUse", 0.2)].join("\n");
    expect(turnCostsFromSession(text)).toEqual([0.1]);
  });

  it("坏行和没有 usage 的消息跳过", () => {
    const text = [
      "{not json",
      user(),
      JSON.stringify({ type: "message", message: { role: "assistant", stopReason: "stop" } }),
      "",
      assistant("aborted", 0.3),
      '{"type":"message","message":{"role":"assis',
    ].join("\n");
    expect(turnCostsFromSession(text)).toEqual([0, 0.3]);
  });

  it("没有文件时返回 []", async () => {
    expect(await readTurnCosts(null)).toEqual([]);
    expect(await readTurnCosts(path.join(import.meta.dirname, "no-such-session.jsonl"))).toEqual([]);
  });
});
