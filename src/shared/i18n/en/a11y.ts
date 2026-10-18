import type { MessageEntry } from "../index.ts";
import type { a11y as zhCN } from "../zh-CN/a11y.ts";

export const a11y = {
  chat: "Conversation",
  done: "Finished: {summary}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
