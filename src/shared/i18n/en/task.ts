import type { MessageEntry } from "../index.ts";
import type { task as zhCN } from "../zh-CN/task.ts";

export const task = {
  untitled: "New task",
  rename: "Rename",
  keepAlive: "Keep running",
  keepAliveOff: "Stop keeping running",
  renameLabel: "Task title",
  archive: "Archive",
  archived: "Archived",
  undo: "Undo",
  openFolder: "Open working folder",
  reveal: "Show session file",
  copyId: "Copy session ID",
  copyPath: "Copy session file path",
  stopped: "Stopped",
  more: "More actions",
  runningFor: "{n}m",
  noSession: "This task has no session file yet.",
  restart: "Restart session",
  restartTip: "Reload the conversation from the session file, plus skills, MCP servers, plugins and settings",
  restartBusyRunning: "Running; restart when it finishes",
  restartBusyWaiting: "Waiting for your answer; answer it first",
  restartBusyStarting: "The task is starting",
  restartBusyBackground: "Background work is still running; restart when it finishes",
  exportHtml: "Export as HTML…",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
