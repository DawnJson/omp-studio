import type { MessageEntry } from "../index.ts";
import type { thinking as zhCN } from "../zh-CN/thinking.ts";

export const thinking = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
