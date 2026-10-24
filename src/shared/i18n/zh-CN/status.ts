import type { MessageEntry } from "../index.ts";

export const status = {
  running: "进行中",
  waiting: "等你确认",
  done: "完成",
  error: "出错",
  interrupted: "已中断",
  interruptedTip: "中途停下，打开可继续",
} satisfies Record<string, MessageEntry>;
