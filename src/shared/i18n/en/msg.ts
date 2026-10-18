import type { MessageEntry } from "../index.ts";
import type { msg as zhCN } from "../zh-CN/msg.ts";

export const msg = {
  sendFailed: "Not sent",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
