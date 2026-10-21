// 上下文构成的分段（composer/context-rows.ts）：各段加起来正好是窗口；读不到压缩设置时没有预留段，没有构成数据时没有系统提示词和工具两行。
import { describe, expect, it } from "vitest";
import { contextRows } from "../src/renderer/src/features/composer/context-rows.ts";

const usage = (tokens: number, contextWindow = 1000) => ({
  tokens,
  contextWindow,
  percent: (tokens / contextWindow) * 100,
});
const parts = { systemTokens: 100, toolTokens: 50, toolCount: 3 };
const byPart = (rows: ReturnType<typeof contextRows>) => Object.fromEntries(rows.map((row) => [row.part, row.tokens]));

describe("contextRows", () => {
  it("各段之和等于窗口，预留 = 窗口 - 触发点；系统提示词和工具从消息里分出来", () => {
    const rows = contextRows(usage(300), parts, 900);
    expect(byPart(rows)).toEqual({ system: 100, tools: 50, messages: 150, free: 600, buffer: 100 });
    expect(rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(1000);
  });

  it("系统提示词和工具两行是估算，其余不是", () => {
    expect(contextRows(usage(300), parts, null).map((row) => [row.part, row.estimated])).toEqual([
      ["system", true],
      ["tools", true],
      ["messages", false],
      ["free", false],
    ]);
  });

  it("构成超过实际用量时收到用量以内，消息不为负", () => {
    expect(byPart(contextRows(usage(120), parts, null))).toEqual({ system: 100, tools: 20, messages: 0, free: 880 });
  });

  it("用量已过触发点：预留只算剩下的", () => {
    expect(byPart(contextRows(usage(950), parts, 900))).toMatchObject({ free: 0, buffer: 50 });
  });

  it("没有压缩设置：没有预留；没有构成数据：只有消息和剩余", () => {
    expect(byPart(contextRows(usage(300), parts, null))).toMatchObject({ free: 700 });
    expect(byPart(contextRows(usage(300), null, null))).toEqual({ messages: 300, free: 700 });
  });
});
