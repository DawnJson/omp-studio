// TSP 任务每一轮的费用：读 omp 的会话文件（JSONL），按文件顺序把 assistant 消息归到轮里。
// 一轮 = 连续的 assistant 消息，到第一条 stopReason 不是 "toolUse" 的 assistant 消息为止（含它）；费用是这些消息 usage.cost.total 之和。
// 中途转向（steer）插入的 user 消息和工具结果不切轮；最后一轮还没结束（最后一条 assistant 是 toolUse）时不算。
import { readFile } from "node:fs/promises";
import { isRecord } from "../../shared/type-guards.ts";

/** 从会话文件内容算每一轮的费用（美元），从旧到新。坏行（含写到一半的最后一行）跳过。 */
export function turnCostsFromSession(text: string): number[] {
  const costs: number[] = [];
  let running = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry["type"] !== "message" || !isRecord(entry["message"])) continue;
    const message = entry["message"];
    if (message["role"] !== "assistant") continue;
    const usage = message["usage"];
    const cost = isRecord(usage) && isRecord(usage["cost"]) ? usage["cost"]["total"] : 0;
    running += typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
    if (message["stopReason"] !== "toolUse") {
      costs.push(running);
      running = 0;
    }
  }
  return costs;
}

/** 读会话文件算每轮费用；没有文件（新会话第一条回复之后才落盘）、读失败时 []。 */
export async function readTurnCosts(file: string | null): Promise<number[]> {
  if (file === null) return [];
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? [] : turnCostsFromSession(text);
}
