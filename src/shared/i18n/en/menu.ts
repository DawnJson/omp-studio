import type { MessageEntry } from "../index.ts";
import type { menu as zhCN } from "../zh-CN/menu.ts";

export const menu = {
  newTask: "New task",
  toggleSidebar: "Toggle sidebar",
  settings: "Settings",
  edit: "Edit",
  undo: "Undo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
