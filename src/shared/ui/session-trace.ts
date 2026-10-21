// 请求记录（/trace）的纯函数：从 stats.db 的一行请求推出界面要显示的几个量。
// stats.db 里 `duration` / `ttft` 是毫秒（omp 18.12.5 实测，如 duration 5712.76、ttft 3048.44）；stop_reason 的取值见 STOP_KINDS。
import type { TraceRequest } from "../ipc.ts";

/** omp 会话文件里 assistant 消息 stopReason 的已知取值；别的值（omp 以后加的）界面照原文显示。 */
const STOP_KINDS = ["stop", "toolUse", "length", "error", "aborted"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export function stopKind(stopReason: string): StopKind | null {
  return STOP_KINDS.find((kind) => kind === stopReason) ?? null;
}

/** 请求是不是出错结束（stop_reason 为 error，或带错误信息）。 */
export function isFailedRequest(request: Pick<TraceRequest, "stopReason" | "errorMessage">): boolean {
  return request.stopReason === "error" || request.errorMessage !== null;
}

/**
 * 输出速度（token/秒）：输出 token ÷ 生成时间。生成时间 = 总耗时 − 首字耗时（两者都有且差为正）；否则退回总耗时。
 * 这是 studio 自己按这两列算的，不是 omp 的 tps_sum（那个是库里的聚合列）。没有耗时、没有输出时为 null。
 */
export function tokensPerSecond(request: Pick<TraceRequest, "output" | "durationMs" | "ttftMs">): number | null {
  if (request.output <= 0 || request.durationMs === null || request.durationMs <= 0) return null;
  const generating =
    request.ttftMs !== null && request.durationMs - request.ttftMs > 0
      ? request.durationMs - request.ttftMs
      : request.durationMs;
  return request.output / (generating / 1000);
}

export interface TraceSummary {
  requests: number;
  failed: number;
  toolCalls: number;
  failedToolCalls: number;
  costUsd: number;
}

export function summarizeTrace(requests: readonly TraceRequest[]): TraceSummary {
  const summary: TraceSummary = { requests: requests.length, failed: 0, toolCalls: 0, failedToolCalls: 0, costUsd: 0 };
  for (const request of requests) {
    if (isFailedRequest(request)) summary.failed++;
    summary.costUsd += request.costUsd;
    summary.toolCalls += request.tools.length;
    summary.failedToolCalls += request.tools.filter((tool) => tool.isError === true).length;
  }
  return summary;
}
