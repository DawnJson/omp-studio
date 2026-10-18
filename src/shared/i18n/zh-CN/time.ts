import type { MessageEntry } from "../index.ts";

export const time = {
  now: "刚刚",
  minutes: "{n} 分钟",
  hours: "{n} 小时",
  yesterday: "昨天",
} satisfies Record<string, MessageEntry>;
