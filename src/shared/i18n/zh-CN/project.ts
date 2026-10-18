import type { MessageEntry } from "../index.ts";

export const project = {
  reveal: "在资源管理器中显示",
  remove: "从列表移除",
  removeBlocked: "这个项目下还有任务，先归档它们。",
} satisfies Record<string, MessageEntry>;
