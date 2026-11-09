import type { MessageEntry } from "../index.ts";
import type { scroll as zhCN } from "../zh-CN/scroll.ts";

export const scroll = {
  latest: "Jump to latest",
  line: "Conversation outline",
  lineItem: "Message {n}: {text}",
  outline: "Turns",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
