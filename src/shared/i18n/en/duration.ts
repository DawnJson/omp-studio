import type { MessageEntry } from "../index.ts";
import type { duration as zhCN } from "../zh-CN/duration.ts";

export const duration = {
  s: "{s}s",
  ms: "{m}m {s}s",
  hm: "{h}h {m}m",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
