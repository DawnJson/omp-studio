import type { MessageEntry } from "../index.ts";

export const status = {
  running: "进行中",
  waiting: "等你确认",
  error: "出错",
  interrupted: "已中断",
  unread: "有新结果",
} satisfies Record<string, MessageEntry>;
