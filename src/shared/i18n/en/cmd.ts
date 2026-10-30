import type { MessageEntry } from "../index.ts";
import type { cmd as zhCN } from "../zh-CN/cmd.ts";

export const cmd = {
  sessionTree: "Session tree",
  newTask: "New task",
  newTaskHere: "New task in this project",
  openFolder: "Open folder…",
  settings: "Settings",
  toggleSidebar: "Toggle sidebar",
  theme: "Choose theme…",
  language: "Switch language",
  model: "Switch model",
  thinking: "Cycle thinking level",
  compact: "Compact context",
  stop: "Stop current task",
  copyLast: "Copy last answer",
  copyLastEmpty: "No answer to copy yet",
  toggleProcess: "Expand or collapse all tool cards",
  jumpWaiting: "Jump to a task waiting for you",
  checkUpdate: "Check for omp updates",
  shortcuts: "Keyboard shortcuts",
  archive: "Archive current task",
  usage: "View usage",
  plugins: "Manage plugins and marketplaces",
  toggleTerminal: "Toggle terminal",
  exportHtml: "Export conversation as HTML…",
  btw: "Ask a side question (/btw)",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
