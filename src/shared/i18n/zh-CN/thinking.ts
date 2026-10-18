import type { MessageEntry } from "../index.ts";

export const thinking = {
  off: "关",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
} satisfies Record<string, MessageEntry>;
