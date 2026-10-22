import type { MessageEntry } from "../index.ts";

export const menu = {
  newTask: "新任务",
  toggleSidebar: "切换侧栏",
  settings: "设置",
} satisfies Record<string, MessageEntry>;
