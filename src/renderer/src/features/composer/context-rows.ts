// 上下文构成的分段（ContextBreakdown 用，纯函数）：系统提示词、工具定义（omp 在会话文件里记的 token 数）、消息、剩余空间、自动压缩预留，
// 各段之和正好是窗口。系统提示词 + 工具定义超过 omp 给的实际用量时收到用量以内，消息不会是负数。
import type { ContextParts, TaskState } from "../../../../shared/ipc.ts";

type ContextPart = "system" | "tools" | "messages" | "free" | "buffer";

export interface ContextRow {
  part: ContextPart;
  tokens: number;
  /** 系统提示词、工具定义是 omp 按请求估的数，不是供应商返回的用量：前面画 ≈。 */
  estimated: boolean;
}

/** trigger：omp 的压缩触发点（token 数）；读不到压缩设置时为 null，不分出预留段。parts 为 null（草稿、omp 没记）时没有系统提示词和工具定义两行。 */
export function contextRows(
  context: NonNullable<TaskState["contextUsage"]>,
  parts: ContextParts | null,
  trigger: number | null,
): ContextRow[] {
  const window = context.contextWindow;
  const used = Math.min(context.tokens, window);
  const system = Math.min(parts?.systemTokens ?? 0, used);
  const tools = Math.min(parts?.toolTokens ?? 0, used - system);
  const buffer = trigger === null ? 0 : Math.max(0, window - Math.max(trigger, used));
  const rows: ContextRow[] = [];
  if (parts !== null) {
    rows.push({ part: "system", tokens: system, estimated: true });
    rows.push({ part: "tools", tokens: tools, estimated: true });
  }
  rows.push({ part: "messages", tokens: used - system - tools, estimated: false });
  rows.push({ part: "free", tokens: Math.max(0, window - used - buffer), estimated: false });
  if (buffer > 0) rows.push({ part: "buffer", tokens: buffer, estimated: false });
  return rows;
}
