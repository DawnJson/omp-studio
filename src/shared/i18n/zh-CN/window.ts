import type { MessageEntry } from "../index.ts";

export const window = {
  toggleSidebar: "切换侧栏",
  menu: "菜单",
  back: "后退",
  forward: "前进",
} satisfies Record<string, MessageEntry>;
