import type { MessageEntry } from "../index.ts";
import type { status as zhCN } from "../zh-CN/status.ts";

export const status = {
  running: "Running",
  waiting: "Waiting for you",
  done: "Done",
  error: "Error",
  interrupted: "Interrupted",
  interruptedTip: "Stopped partway; open it to continue",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
