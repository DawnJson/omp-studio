import type { MessageEntry } from "../index.ts";
import type { status as zhCN } from "../zh-CN/status.ts";

export const status = {
  running: "Running",
  runningAgents: { one: "Running, {count} subagent", other: "Running, {count} subagents" },
  waiting: "Waiting for you",
  done: "Done",
  error: "Error",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
