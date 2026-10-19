import type { MessageEntry } from "../index.ts";

export const window = {
  menu: "菜单",
  appMenu: "omp studio 菜单",
  runningFor: "运行中 · {time}",
} satisfies Record<string, MessageEntry>;
