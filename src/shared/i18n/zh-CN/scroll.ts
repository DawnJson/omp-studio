import type { MessageEntry } from "../index.ts";

export const scroll = {
  latest: "回到最新",
  line: "对话线",
  lineItem: "第 {n} 条：{text}",
  outline: "对话大纲",
} satisfies Record<string, MessageEntry>;
