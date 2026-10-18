import type { MessageEntry } from "../index.ts";

export const toast = {
  needsYou: "{task} 需要你确认",
  view: "查看",
  dismiss: "关闭通知",
} satisfies Record<string, MessageEntry>;
