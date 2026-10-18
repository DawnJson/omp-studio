import type { MessageEntry } from "../index.ts";

export const duration = {
  s: "{s} 秒",
  ms: "{m} 分 {s} 秒",
  hm: "{h} 小时 {m} 分",
} satisfies Record<string, MessageEntry>;
