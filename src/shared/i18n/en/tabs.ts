import type { MessageEntry } from "../index.ts";
import type { tabs as zhCN } from "../zh-CN/tabs.ts";

export const tabs = {
  label: "Task tabs",
  close: "Close tab",
  closeRunningTitle: "Close tab?",
  closeRunningBody: "“{title}” is still running. Closing the tab stops it.",
  closeManyRunningBody: "{count} of these tasks are still running. Closing the tabs stops them.",
  closeRunningConfirm: "Stop and close",
  menu: "Tab menu",
  rename: "Rename",
  color: "Color",
  colorNone: "No color",
  colorN: "Color {n}",
  closeOthers: "Close other tabs",
  closeRight: "Close tabs to the right",
  closeAll: "Close all",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
