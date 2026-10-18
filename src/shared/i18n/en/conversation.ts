import type { MessageEntry } from "../index.ts";
import type { conversation as zhCN } from "../zh-CN/conversation.ts";

export const conversation = {} satisfies Record<keyof typeof zhCN, MessageEntry>;
