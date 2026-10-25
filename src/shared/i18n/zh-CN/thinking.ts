import type { MessageEntry } from "../index.ts";

// 思考强度档位在中文界面里也写英文，和 en 相同（仓库所有者 2026-10-25 定）。
export const thinking = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
} satisfies Record<string, MessageEntry>;
