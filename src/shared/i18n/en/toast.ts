import type { MessageEntry } from "../index.ts";
import type { toast as zhCN } from "../zh-CN/toast.ts";

export const toast = {
  needsYou: "{task} needs your confirmation",
  view: "View",
  dismiss: "Dismiss",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
