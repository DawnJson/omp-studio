// 已完成的子代理被主代理用 IRC 唤醒后又在跑（issue #23）：omp 不更新它的 `agent` 节点（一直是 done），
// 只有它的记录文件 `<名字>.jsonl` 照常边跑边写。这里按记录文件的条目判断它现在是在跑还是停着。
// 依据是 omp 19.0.1 的实测和所有者机器上约 2000 个子代理记录文件（docs/architecture/subagents.md「给已完成的子代理派新任务」）：
// - 一轮结束：assistant 消息的 stopReason 不是 toolUse（stop / error / aborted …），或 `yield` 工具成功返回（常和别的工具并行，结果顺序不定）；
// - 唤醒：先追加 `{type:"custom_message", customType:"irc:incoming"}`，约 1.6 秒后出现 assistant toolUse，之后工具结果照常写。
//   只认后面的 assistant / user 条目，不认 `irc:incoming` 本身：omp 在子代理开着 plan mode 时只记下 IRC、不唤醒它
//   （omp 19.0.1 的 irc-bridge `deliver()` 返回 "injected"），按 IRC 算会一直显示在跑；
// - 别的 custom_message（advisor、async-result 等）和 `custom` 条目会在一轮结束后追加，不代表在跑。
import { isRecord } from "../type-guards.ts";

export type RevivalState = "idle" | "running";

const YIELD_TOOL = "yield";

/** 记录文件的一条（一行 JSON）推进状态。 */
function stepRevival(state: RevivalState, entry: unknown): RevivalState {
  if (!isRecord(entry)) return state;
  const message = entry["message"];
  if (entry["type"] !== "message" || !isRecord(message)) return state;
  switch (message["role"]) {
    case "assistant":
      return message["stopReason"] === "toolUse" ? "running" : "idle";
    case "toolResult":
      return message["toolName"] === YIELD_TOOL && message["isError"] !== true ? "idle" : state;
    case "user":
    case "developer":
      return "running";
    default:
      return state;
  }
}

/** 若干完整的行（`\n` 分隔）依次推进状态；解析不了的行跳过。 */
export function scanRevival(state: RevivalState, lines: string): RevivalState {
  let next = state;
  for (const line of lines.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    next = stepRevival(next, entry);
  }
  return next;
}
