import type { MessageEntry } from "../index.ts";

export const history = {
  untitled: "未命名会话",
  resumeFailed: "无法恢复这个会话：{message}",
} satisfies Record<string, MessageEntry>;
