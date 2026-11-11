import type { MessageEntry } from "../index.ts";
import type { status as zhCN } from "../zh-CN/status.ts";

export const status = {
  running: "Running",
  waiting: "Waiting for you",
  error: "Error",
  unread: "New result",
  interrupted: "Interrupted",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
