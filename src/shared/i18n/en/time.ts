import type { MessageEntry } from "../index.ts";
import type { time as zhCN } from "../zh-CN/time.ts";

export const time = {
  now: "Just now",
  minutes: "{n}m",
  hours: "{n}h",
  yesterday: "Yesterday",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
