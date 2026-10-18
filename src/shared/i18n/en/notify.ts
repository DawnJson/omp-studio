import type { MessageEntry } from "../index.ts";
import type { notify as zhCN } from "../zh-CN/notify.ts";

export const notify = {
  title: "{project} · {task}",
  "body.gate": "Needs your confirmation: {title}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
