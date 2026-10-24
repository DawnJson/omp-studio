import type { MessageEntry } from "../index.ts";
import type { tsp as zhCN } from "../zh-CN/tsp.ts";

export const tsp = {
  layoutRegion: "Conversation",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
