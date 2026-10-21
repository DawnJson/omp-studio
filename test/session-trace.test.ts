import { describe, expect, it } from "vitest";
import type { TraceRequest } from "../src/shared/ipc.ts";
import { isFailedRequest, stopKind, summarizeTrace, tokensPerSecond } from "../src/shared/ui/session-trace.ts";

const request = (patch: Partial<TraceRequest> = {}): TraceRequest => ({
  entryId: "e",
  timestamp: 1,
  model: "deepseek-v4-flash",
  provider: "deepseek",
  agentType: "main",
  stopReason: "stop",
  errorMessage: null,
  input: 4,
  output: 150,
  cacheRead: 0,
  cacheWrite: 0,
  total: 154,
  costUsd: 0.0229732,
  // omp 18.12.5 stats.db 里的一行实测值（毫秒）。
  durationMs: 5712.7644999999975,
  ttftMs: 3048.443800000001,
  serviceTier: null,
  tools: [],
  ...patch,
});

describe("stopKind / isFailedRequest", () => {
  it("认识 omp 的 stopReason；不认识的返回 null（界面显示原文）", () => {
    expect(["stop", "toolUse", "length", "error", "aborted"].map(stopKind)).toEqual([
      "stop",
      "toolUse",
      "length",
      "error",
      "aborted",
    ]);
    expect(stopKind("somethingNew")).toBeNull();
  });

  it("stopReason 为 error 或带错误信息都算失败", () => {
    expect(isFailedRequest(request())).toBe(false);
    expect(isFailedRequest(request({ stopReason: "error" }))).toBe(true);
    expect(isFailedRequest(request({ errorMessage: "401" }))).toBe(true);
  });
});

describe("tokensPerSecond", () => {
  it("输出 token ÷（总耗时 − 首字耗时）", () => {
    // 150 / ((5712.76 − 3048.44) / 1000) ≈ 56.3
    expect(tokensPerSecond(request())!).toBeCloseTo(56.3, 1);
  });

  it("没有首字耗时（或不比总耗时短）退回总耗时", () => {
    expect(tokensPerSecond(request({ ttftMs: null, durationMs: 5000, output: 100 }))).toBe(20);
    expect(tokensPerSecond(request({ ttftMs: 6000, durationMs: 5000, output: 100 }))).toBe(20);
  });

  it("没有耗时、耗时为 0、没有输出：null", () => {
    expect(tokensPerSecond(request({ durationMs: null }))).toBeNull();
    expect(tokensPerSecond(request({ durationMs: 0 }))).toBeNull();
    expect(tokensPerSecond(request({ output: 0 }))).toBeNull();
  });
});

describe("summarizeTrace", () => {
  it("请求数、失败数、工具调用（含出错的）、费用合计", () => {
    const summary = summarizeTrace([
      request({
        costUsd: 0.5,
        tools: [
          { name: "read", isError: false, argsChars: 1, resultChars: 2 },
          { name: "bash", isError: true, argsChars: 1, resultChars: 2 },
        ],
      }),
      request({ costUsd: 0.25, stopReason: "error" }),
      request({ costUsd: 0, tools: [{ name: "read", isError: null, argsChars: 1, resultChars: null }] }),
    ]);
    expect(summary).toEqual({ requests: 3, failed: 1, toolCalls: 3, failedToolCalls: 1, costUsd: 0.75 });
  });

  it("空列表全 0", () => {
    expect(summarizeTrace([])).toEqual({ requests: 0, failed: 0, toolCalls: 0, failedToolCalls: 0, costUsd: 0 });
  });
});
