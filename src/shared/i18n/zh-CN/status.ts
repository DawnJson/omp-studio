import type { MessageEntry } from "../index.ts";

export const status = {
  running: "进行中",
  waiting: "等你确认",
  done: "完成",
  error: "出错",
} satisfies Record<string, MessageEntry>;
