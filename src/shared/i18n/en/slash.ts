import type { MessageEntry } from "../index.ts";
import type { slash as zhCN } from "../zh-CN/slash.ts";

export const slash = {
  empty: "No matching commands",
  label: "Slash commands",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
