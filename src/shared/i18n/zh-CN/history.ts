import type { MessageEntry } from "../index.ts";

export const history = {
  untitled: "未命名会话",
  resumeFailed: "无法恢复这个会话：{message}",
  listFailed: "会话列表加载失败：{message}",
} satisfies Record<string, MessageEntry>;
