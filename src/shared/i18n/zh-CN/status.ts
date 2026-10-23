import type { MessageEntry } from "../index.ts";

export const status = {
  running: "进行中",
  waiting: "等你确认",
  done: "完成",
  error: "出错",
  interrupted: "已中断",
  interruptedTip: "这个会话在中途停下了（停在工具调用上或长度上限）。打开它可以接着做。",
} satisfies Record<string, MessageEntry>;
