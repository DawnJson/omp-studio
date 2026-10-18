import type { MessageEntry } from "../index.ts";
import type { code as zhCN } from "../zh-CN/code.ts";

export const code = {
  expand: "Show all ({n} lines)",
  copy: "Copy code",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
