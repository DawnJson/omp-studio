// omp 恢复会话（`--resume`）时不重发每轮回答下方的用量脚注（omp.turn.usage）：omp 18.12.4 的 TSP 恢复路径只重发
// omp.user / 工具卡片 / omp.assistant，不带用量行。从会话文件补出来（只读，不写 ~/.omp；assistant 消息的 usage、completedAt，
// 用户消息的 timestamp）。空闲回顾（omp.recap）omp 恢复时也不重放，studio 照 omp，不补（2026-10-25 起）。
// 统计口径照抄 omp 的 TurnUsageAggregator（`l7e`，packages/tui 的 chat-transcript-builder / usage-row）：非 agent 的用户消息
// （和合成的 developer 消息）清零累计，assistant 消息累计 input+cacheWrite（+orchestration.input）、output（+orchestration.output）、
// cost.total，遇到 stopReason 不是 toolUse 的消息结算（被打断、出错的消息也结算）；耗时 = 该消息 completedAt − 开这一轮的用户消息
// timestamp（≤0 当没有）。每轮用量合一：这里是唯一一份解析，turn 里直接带 cost，文字由 turn-footer.ts 按 omp 的 `tLo` 写（`<$0.01`）。
import { readFile } from "node:fs/promises";
import type { TspSessionExtras, TspTurnFooter } from "../../shared/ipc.ts";
import { tokensPerSecond } from "../../shared/ui/session-trace.ts";
import { isRecord } from "../../shared/type-guards.ts";

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

interface ParsedSession {
  turns: (TspTurnFooter | null)[];
  /** 最近一条回复的输出速度（见 replySpeed）；没有时为 null。 */
  tokensPerSecond: number | null;
}

/**
 * 一条 assistant 消息的输出速度（token/秒）：输出 ÷（`duration` − `ttft`），算法同请求记录页（shared/ui/session-trace.ts）。
 * `duration` / `ttft` 是毫秒（omp 18.12.5 实测，消息写盘时带上）；出错、被停止的消息、没有输出或耗时的消息返回 null。
 */
function replySpeed(message: Record<string, unknown>): number | null {
  if (message["stopReason"] === "error" || message["stopReason"] === "aborted") return null;
  const usage = isRecord(message["usage"]) ? message["usage"] : {};
  const duration = finite(message["duration"]);
  const ttft = finite(message["ttft"]);
  return tokensPerSecond({
    output: finite(usage["output"]),
    durationMs: duration > 0 ? duration : null,
    ttftMs: ttft > 0 ? ttft : null,
  });
}

/** 从会话文件内容解析；坏行（含写到一半的最后一行）跳过。 */
export function parseSession(text: string): ParsedSession {
  const result: ParsedSession = { turns: [], tokensPerSecond: null };
  let userAt: number | null = null;
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (entry["type"] !== "message" || !isRecord(entry["message"])) continue;
    const message = entry["message"];
    const timestamp = finite(message["timestamp"]);
    if (message["role"] === "user" && message["attribution"] !== "agent") {
      result.turns.push(null);
      userAt = timestamp > 0 ? timestamp : null;
      input = output = cost = 0;
      continue;
    }
    // 合成的 developer 消息（omp 的 chat-transcript-builder 同样清零）：用户发起的从它的时间戳起算，否则没有起点。
    if (message["role"] === "developer" && message["synthetic"] === true) {
      userAt = message["userInitiated"] === true && timestamp > 0 ? timestamp : null;
      input = output = cost = 0;
      continue;
    }
    if (message["role"] !== "assistant") continue;
    const speed = replySpeed(message);
    if (speed !== null) result.tokensPerSecond = speed;
    const usage = isRecord(message["usage"]) ? message["usage"] : {};
    const orchestration = isRecord(usage["orchestration"]) ? usage["orchestration"] : {};
    const usageCost = isRecord(usage["cost"]) ? finite(usage["cost"]["total"]) : 0;
    input += finite(usage["input"]) + finite(usage["cacheWrite"]) + finite(orchestration["input"]);
    output += finite(usage["output"]) + finite(orchestration["output"]);
    cost += usageCost;
    if (message["stopReason"] === "toolUse") continue;
    if (result.turns.length > 0 && (input + output > 0 || cost > 0)) {
      const completedAt = finite(message["completedAt"]);
      const elapsed = userAt !== null && completedAt > 0 ? Math.round(completedAt - userAt) : 0;
      result.turns[result.turns.length - 1] = { elapsedMs: elapsed > 0 ? elapsed : null, input, output, cost };
    }
    input = output = cost = 0;
  }
  return result;
}

/** 读会话文件补用量脚注和最近一条回复的速度；没有文件（新会话第一条回复之后才落盘）、读失败时为空。 */
export async function readSessionExtras(file: string | null): Promise<TspSessionExtras> {
  const empty: TspSessionExtras = { turns: [], tokensPerSecond: null };
  if (file === null) return empty;
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return empty;
  return parseSession(text);
}
