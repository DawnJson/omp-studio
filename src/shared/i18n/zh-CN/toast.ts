import type { MessageEntry } from "../index.ts";

export const toast = {
  needsYou: "{task} 需要你确认",
  view: "查看",
  dismiss: "关闭通知",
  exported: "已导出 {name}",
  revealExport: "在文件夹中显示",
} satisfies Record<string, MessageEntry>;
