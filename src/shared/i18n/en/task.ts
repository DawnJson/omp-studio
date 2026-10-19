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
  reveal: "Show in File Explorer",
  copyId: "Copy session ID",
  copyPath: "Copy session file path",
  stopped: "Stopped",
  more: "More actions",
  runningFor: "{n}m",
  noSession: "This task has no session file yet.",
  exportHtml: "Export as HTML…",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
