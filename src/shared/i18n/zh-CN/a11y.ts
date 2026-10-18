import type { MessageEntry } from "../index.ts";

export const a11y = {
  chat: "对话",
  done: "已完成：{summary}",
} satisfies Record<string, MessageEntry>;
