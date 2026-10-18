import type { MessageEntry } from "../index.ts";

export const notify = {
  title: "{project} · {task}",
  "body.gate": "需要你确认：{title}",
} satisfies Record<string, MessageEntry>;
