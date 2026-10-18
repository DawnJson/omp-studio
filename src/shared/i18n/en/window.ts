import type { MessageEntry } from "../index.ts";
import type { window as zhCN } from "../zh-CN/window.ts";

export const window = {
  toggleSidebar: "Toggle sidebar",
  menu: "Menu",
  back: "Back",
  forward: "Forward",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
