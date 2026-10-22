import type { MessageEntry } from "../index.ts";
import type { shortcut as zhCN } from "../zh-CN/shortcut.ts";

export const shortcut = {
  palette: "Command palette",
  newTask: "New task",
  focusSearch: "Search tasks and sessions",
  openFolder: "Open folder",
  settings: "Settings",
  toggleSidebar: "Toggle sidebar",
  send: "Send",
  newline: "New line",
  later: "While running: later",
  stop: "Stop and recall the queue",
  toggleProcess: "Expand / collapse tool cards",
  focusComposer: "Focus the message box",
  nthTask: "Go to task N",
  prevNext: "Previous or next task",
  regions: "Move between areas",
  review: "Open review",
  reviewFiles: "Review: previous / next file",
  reviewHunks: "Review: previous / next change",
  reviewLayout: "Review: unified / side by side",
  toggleTerminal: "Terminal: open / focus / return",
  toggleFiles: "File panel: open / close",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
