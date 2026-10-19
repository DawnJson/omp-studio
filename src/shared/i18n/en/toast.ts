import type { MessageEntry } from "../index.ts";
import type { toast as zhCN } from "../zh-CN/toast.ts";

export const toast = {
  needsYou: "{task} needs your confirmation",
  view: "View",
  dismiss: "Dismiss",
  exported: "Exported {name}",
  revealExport: "Show in folder",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
