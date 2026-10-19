import type { MessageEntry } from "../index.ts";
import type { window as zhCN } from "../zh-CN/window.ts";

export const window = {
  menu: "Menu",
  appMenu: "omp studio menu",
  runningFor: "Running · {time}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
