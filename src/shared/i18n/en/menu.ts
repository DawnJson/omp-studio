import type { MessageEntry } from "../index.ts";
import type { menu as zhCN } from "../zh-CN/menu.ts";

export const menu = {
  newTask: "New task",
  toggleSidebar: "Toggle sidebar",
  settings: "Settings",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
