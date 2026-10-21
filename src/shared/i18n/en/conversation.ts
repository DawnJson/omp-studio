import type { MessageEntry } from "../index.ts";
import type { conversation as zhCN } from "../zh-CN/conversation.ts";

export const conversation = {
  imageAlt: "Image",
  todoTitle: "Progress",
  "todo.pending": "Pending",
  "todo.in_progress": "In progress",
  "todo.completed": "Completed",
  "todo.blocked": "Blocked",
  "todo.abandoned": "Abandoned",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
