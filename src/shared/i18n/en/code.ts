import type { MessageEntry } from "../index.ts";
import type { code as zhCN } from "../zh-CN/code.ts";

export const code = {
  copy: "Copy code",
  source: "View source",
  figure: "Figure drawn by the assistant",
  figureFailed: "This figure couldn't be drawn; its source is below",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
