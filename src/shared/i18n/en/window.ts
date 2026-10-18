import type { MessageEntry } from "../index.ts";
import type { window as zhCN } from "../zh-CN/window.ts";

export const window = {
  toggleSidebar: "Toggle sidebar",
  more: "More",
  menu: "Menu",
  back: "Back",
  forward: "Forward",
  whatsNew: "What's new",
  ompUpdate: "omp update available",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
