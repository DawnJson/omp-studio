import type { MessageEntry } from "../index.ts";

export const window = {
  toggleSidebar: "切换侧栏",
  more: "更多",
  menu: "菜单",
  back: "后退",
  forward: "前进",
  whatsNew: "新功能",
  ompUpdate: "omp 可升级",
} satisfies Record<string, MessageEntry>;
