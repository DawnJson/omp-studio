import type { MessageEntry } from "../index.ts";
import type { task as zhCN } from "../zh-CN/task.ts";

export const task = {
  untitled: "New task",
  forkTitle: "{title} (fork)",
  rename: "Rename",
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
  restartTip: "Reload skills, MCP servers, plugins and settings",
  restartBusyRunning: "Running; restart when it finishes",
  restartBusyWaiting: "Waiting for your answer; answer it first",
  restartBusyStarting: "The task is starting",
  restartBusyBackground: "Background jobs, subagents or a side question are still running; restart when they finish",
  exportHtml: "Export as HTML…",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
