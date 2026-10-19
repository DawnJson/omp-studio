// 上下文构成的分段（composer/context-rows.ts）：各段加起来正好是窗口；估算的系统提示词 / 工具超过实际用量时
// 收到用量以内，消息不会是负数；读不到压缩设置时没有预留段。
import { describe, expect, it } from "vitest";
import { contextRows } from "../src/renderer/src/features/composer/context-rows.ts";

const usage = (tokens: number, contextWindow = 1000) => ({
  tokens,
  contextWindow,
  percent: (tokens / contextWindow) * 100,
});
const parts = (systemTokens: number, toolTokens: number) => ({ systemTokens, toolTokens, toolCount: 3 });
const byPart = (rows: ReturnType<typeof contextRows>) => Object.fromEntries(rows.map((row) => [row.part, row.tokens]));

describe("contextRows", () => {
  it("各段之和等于窗口，预留 = 窗口 - 触发点", () => {
    const rows = contextRows(usage(300), parts(50, 70), 900);
    expect(byPart(rows)).toEqual({ system: 50, tools: 70, messages: 180, free: 600, buffer: 100 });
    expect(rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(1000);
  });

  it("估算超过实际用量：收到用量以内，消息为 0", () => {
    expect(byPart(contextRows(usage(100), parts(80, 70), 900))).toMatchObject({ system: 80, tools: 20, messages: 0 });
  });

  it("用量已过触发点：预留只算剩下的", () => {
    expect(byPart(contextRows(usage(950), parts(0, 0), 900))).toMatchObject({ free: 0, buffer: 50 });
  });

  it("没有分项、没有压缩设置：只有消息和剩余", () => {
    expect(byPart(contextRows(usage(300), null, null))).toEqual({ messages: 300, free: 700 });
  });
});
