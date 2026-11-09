import type { MessageEntry } from "../index.ts";
import type { project as zhCN } from "../zh-CN/project.ts";

export const project = {
  reveal: "Show in File Explorer",
  remove: "Remove from list",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
