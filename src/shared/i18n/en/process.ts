import type { MessageEntry } from "../index.ts";
import type { process as zhCN } from "../zh-CN/process.ts";

export const process = {
  starting: "Starting…",
  thinking: "Thinking…",
  replying: "Replying…",
  retrying: "Model error, retrying ({i}/{n})…",
  retryingNow: "Model error, retrying…",
  compacting: "Compacting context…",
  waiting: "Waiting for you · paused {duration}",
  subagentsRunning: { one: "{count} subagent", other: "{count} subagents" },
  done: "Worked for {duration}",
  toolCalls: { one: "{count} tool call", other: "{count} tool calls" },
  subagents: { one: "{count} subagent", other: "{count} subagents" },
  failures: { one: "{count} failure", other: "{count} failures" },
  thought: "Thought · {duration}",
  thoughtShort: "Thought",
  earlier: "{n} earlier",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
