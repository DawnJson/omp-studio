import type { MessageEntry } from "../index.ts";
import type { scroll as zhCN } from "../zh-CN/scroll.ts";

export const scroll = {
  latest: "Jump to latest",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
