import type { MessageEntry } from "../index.ts";
import type { turn as zhCN } from "../zh-CN/turn.ts";

export const turn = {
  noResult: "No result. Expand the work to see why.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
