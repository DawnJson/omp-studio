import type { MessageEntry } from "../index.ts";
import type { status as zhCN } from "../zh-CN/status.ts";

export const status = {
  running: "Running",
  waiting: "Waiting for you",
  done: "Done",
  error: "Error",
  interrupted: "Interrupted",
  interruptedTip: "This session stopped partway (on a tool call or at the length limit). Open it to continue.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
