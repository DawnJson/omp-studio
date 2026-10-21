import type { MessageEntry } from "../index.ts";

export const conversation = {
  imageAlt: "图片",
  todoTitle: "进度",
  "todo.pending": "未开始",
  "todo.in_progress": "进行中",
  "todo.completed": "已完成",
  "todo.blocked": "受阻",
  "todo.abandoned": "已放弃",
} satisfies Record<string, MessageEntry>;
