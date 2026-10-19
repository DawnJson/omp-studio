import type { MessageEntry } from "../index.ts";
import type { cmd as zhCN } from "../zh-CN/cmd.ts";

export const cmd = {
  newTask: "New task",
  newTaskHere: "New task in this project",
  openFolder: "Open folder…",
  settings: "Settings",
  toggleSidebar: "Toggle sidebar",
  theme: "Switch theme",
  language: "Switch language",
  model: "Switch model",
  thinking: "Cycle thinking level",
  compact: "Compact context",
  stop: "Stop current task",
  copyLast: "Copy last answer",
  toggleProcess: "Expand or collapse latest work",
  jumpWaiting: "Jump to a task waiting for you",
  checkUpdate: "Check for omp updates",
  shortcuts: "Keyboard shortcuts",
  archive: "Archive current task",
  usage: "View usage",
  toggleTerminal: "Toggle terminal",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
