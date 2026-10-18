import type { MessageEntry } from "../index.ts";
import type { project as zhCN } from "../zh-CN/project.ts";

export const project = {
  reveal: "Show in File Explorer",
  remove: "Remove from list",
  removeBlocked: "This project still has tasks. Archive them first.",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
