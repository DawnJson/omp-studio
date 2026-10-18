import type { MessageEntry } from "../index.ts";

export const slash = {
  empty: "没有匹配的命令",
  label: "斜杠命令",
} satisfies Record<string, MessageEntry>;
