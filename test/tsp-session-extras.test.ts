import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSession } from "../src/main/tsp/session-extras.ts";
import { formatDuration, formatTokens, formatTurnFooter } from "../src/renderer/src/features/tsp/turn-footer.ts";
import { loadTspFixture, tspFixtureDir } from "./tsp-fixtures.ts";

const header = JSON.stringify({ type: "session", id: "sess-1", cwd: "E:/x" });
const user = (timestamp: number, attribution = "user") =>
  JSON.stringify({ type: "message", message: { role: "user", attribution, timestamp, content: "hi" } });
const assistant = (
  stopReason: string,
  usage: Record<string, unknown>,
  completedAt?: number,
  timestamp = completedAt ?? 0,
) => JSON.stringify({ type: "message", message: { role: "assistant", stopReason, usage, completedAt, timestamp } });
const tokens = (input: number, output: number, total: number, extra: Record<string, unknown> = {}) => ({
  input,
  output,
  cacheWrite: 0,
  cost: { total },
  ...extra,
});

describe("parseSession（会话文件 → 每轮用量脚注）", () => {
  it("一轮里的多次工具调用累加，耗时 = 最终回复的 completedAt − 用户消息 timestamp", () => {
    const text = [
      header,
      user(1000),
      assistant("toolUse", tokens(100, 10, 0.001), 1500),
      assistant("stop", tokens(50, 5, 0.002), 4000),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: 3000, input: 150, output: 15, cost: 0.003 }]);
  });

  it("cacheWrite 算输入，orchestration 的 token 并入；缓存读取不算", () => {
    const text = [
      user(0),
      assistant("stop", {
        input: 10,
        output: 2,
        cacheRead: 999,
        cacheWrite: 5,
        orchestration: { input: 3, output: 4 },
        cost: { total: 0 },
      }),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: null, input: 18, output: 6, cost: 0 }]);
  });

  it("每个非 agent 用户消息一项：没结束的轮、没有用量的轮是 null；agent 归属的用户消息不开新轮", () => {
    const text = [
      user(1),
      assistant("stop", tokens(1, 1, 0.1), 10),
      user(2),
      assistant("toolUse", tokens(1, 1, 0.1), 20),
      user(3),
      assistant("stop", tokens(0, 0, 0), 30),
      user(4, "agent"),
      assistant("stop", tokens(7, 3, 0.4), 50),
    ].join("\n");
    const { turns } = parseSession(text);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({ elapsedMs: 9, input: 1, output: 1, cost: 0.1 });
    expect(turns[1]).toBeNull();
    // 第 3 轮：空回复没用量 → null，agent 消息之后的回复算在这一轮里
    expect(turns[2]).toEqual({ elapsedMs: 47, input: 7, output: 3, cost: 0.4 });
  });

  it("坏行（含写到一半的最后一行）跳过", () => {
    const text = [header, user(5), assistant("stop", tokens(1, 1, 0), 9, 8), user(20), '{"type":"mess'].join("\n");
    const parsed = parseSession(text);
    expect(parsed.turns).toHaveLength(2);
  });

  it("真实录制的会话（fixtures/tsp/resume-session.jsonl，3 个用户消息）", async () => {
    const text = await readFile(path.join(tspFixtureDir, "resume-session.jsonl"), "utf8");
    const parsed = parseSession(text);
    expect(parsed.turns).toEqual([
      { elapsedMs: 11215, input: 1973, output: 886, cost: 0.001909308 },
      { elapsedMs: 47454, input: 1659, output: 1115, cost: 0.002302644 },
      { elapsedMs: 4684, input: 838, output: 259, cost: 0.000899352 },
    ]);
  });
});

describe("最近一条回复的速度（会话文件 assistant 消息，omp 18.12.5 实测字段）", () => {
  // 数字来自一次真实回复：output 2073、duration 9801.9ms、ttft 1015.8ms。
  const real = (stopReason = "stop") =>
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason,
        usage: { input: 201, output: 2073, cost: { total: 0 } },
        duration: 9801.8974,
        ttft: 1015.7713,
        completedAt: 2000,
      },
    });

  it("速度 = 输出 ÷ (duration − ttft)", () => {
    expect(parseSession([user(1000), real()].join("\n")).tokensPerSecond).toBeCloseTo(235.9, 1);
  });

  it("取最后一条：后面有速度的回复覆盖前面的；出错和被停止的回复不改速度", () => {
    const fast = JSON.stringify({
      type: "message",
      message: { role: "assistant", stopReason: "toolUse", usage: { output: 100 }, duration: 1000, ttft: 0 },
    });
    const text = [user(1), real(), user(2), fast, user(3), real("error"), real("aborted")].join("\n");
    expect(parseSession(text).tokensPerSecond).toBe(100);
  });

  it("老版本 omp 的消息没有 duration：速度是 null，不抛错", () => {
    expect(parseSession([user(1), assistant("stop", tokens(1, 5, 0), 10)].join("\n")).tokensPerSecond).toBeNull();
  });
});

describe("脚注文字（和 omp 的 tLo 同格式）", () => {
  it("耗时、token 数的缩写和 omp 一致", () => {
    expect(formatDuration(244)).toBe("244ms");
    expect(formatDuration(11215)).toBe("11.2s");
    expect(formatDuration(125_000)).toBe("2m5s");
    expect(formatDuration(3_780_000)).toBe("1h3m");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatTokens(728)).toBe("728");
    expect(formatTokens(2859)).toBe("2.9K");
    expect(formatTokens(13_400)).toBe("13K");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("费用写法照 omp 的 tLo：不到半分钱 <$0.01，否则两位小数；没有耗时 / 费用的项省略", () => {
    expect(formatTurnFooter({ elapsedMs: 11215, input: 1973, output: 886, cost: 0.001909308 })).toEqual({
      text: "11.2s · 2.9K tok · <$0.01 this turn",
      title: "This turn: 11.2s · 2,859 tokens (1,973 in · 886 out) · <$0.01",
    });
    expect(formatTurnFooter({ elapsedMs: 1, input: 1, output: 1, cost: 0.0049 }).text).toBe(
      "1ms · 2 tok · <$0.01 this turn",
    );
    expect(formatTurnFooter({ elapsedMs: 1, input: 1, output: 1, cost: 0.005 }).text).toBe(
      "1ms · 2 tok · $0.01 this turn",
    );
    expect(formatTurnFooter({ elapsedMs: null, input: 600, output: 128, cost: 0 }).text).toBe("728 tok this turn");
    expect(formatTurnFooter({ elapsedMs: 500, input: 10, output: 5, cost: 0.42 }).text).toBe(
      "500ms · 15 tok · $0.42 this turn",
    );
  });
});

describe("每轮用量只有 parseSession 一份：被打断、steer、压缩后的轮和 omp 实时的写法一致", () => {
  const compaction = JSON.stringify({ type: "compaction", id: "k", summary: "s", firstKeptEntryId: "x" });
  const developer = (timestamp: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "message",
      message: { role: "developer", synthetic: true, timestamp, content: "x", ...extra },
    });

  it("被打断（aborted）的轮：回复里有用量就结算成一轮，没有用量的不算", () => {
    const text = [
      user(100),
      assistant("aborted", tokens(30, 4, 0.002), 700),
      user(800),
      assistant("aborted", tokens(0, 0, 0), 900),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: 600, input: 30, output: 4, cost: 0.002 }, null]);
  });

  it("steer（运行中又发一条用户消息）：新一轮从 steer 起清零，被打断那轮的累计不带过去；脚注归最后那条回复所在的轮", () => {
    const text = [
      user(1000),
      assistant("toolUse", tokens(100, 10, 0.5), 1500), // steer 之前没结算
      user(2000), // steer
      assistant("stop", tokens(7, 3, 0.004), 2600),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([null, { elapsedMs: 600, input: 7, output: 3, cost: 0.004 }]);
  });

  it("压缩条目不是消息：不开轮、不清零；压缩后的新轮照常算", () => {
    const text = [
      user(1),
      assistant("toolUse", tokens(10, 1, 0.1), 5),
      compaction,
      assistant("stop", tokens(20, 2, 0.2), 9),
      user(10),
      assistant("stop", tokens(5, 5, 0.05), 20),
    ].join("\n");
    const { turns } = parseSession(text);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.cost).toBeCloseTo(0.3);
    expect(turns[1]).toEqual({ elapsedMs: 10, input: 5, output: 5, cost: 0.05 });
  });

  it("合成的 developer 消息（omp 的 chat-transcript-builder 同样清零）：用户发起的从它的时间戳起算，否则没有耗时", () => {
    const text = [
      user(1000),
      assistant("toolUse", tokens(100, 10, 0.5), 1200),
      developer(1500, { userInitiated: true }),
      assistant("stop", tokens(7, 3, 0.004), 1900),
    ].join("\n");
    expect(parseSession(text).turns).toEqual([{ elapsedMs: 400, input: 7, output: 3, cost: 0.004 }]);
    const background = [user(1000), developer(1500), assistant("stop", tokens(7, 3, 0.004), 1900)].join("\n");
    expect(parseSession(background).turns).toEqual([{ elapsedMs: null, input: 7, output: 3, cost: 0.004 }]);
  });

  it("文字里恢复出来的行和实时的行同一个写法：费用从 turn 里直接格式化，不再改写 omp 的 <$0.01", () => {
    const text = [user(1000), assistant("stop", tokens(100, 20, 0.0031), 3000)].join("\n");
    const [turn] = parseSession(text).turns;
    expect(formatTurnFooter(turn!).text).toBe("2.0s · 120 tok · <$0.01 this turn");
  });
});

describe("omp 18.12.4 恢复会话的实录（fixtures/tsp/resume.jsonl）", () => {
  it("整段旧对话重发了（3 个 omp.user、每条助手消息一个 omp.assistant），但没有 omp.turn.usage 行——所以 studio 要补", () => {
    const text = JSON.stringify(loadTspFixture("resume"));
    expect(text.match(/"role":"omp\.user"/g)).toHaveLength(3);
    expect(text).toContain('"role":"omp.assistant"');
    expect(text).not.toContain("omp.turn.usage");
    expect(text).not.toContain("omp.recap");
  });
});
