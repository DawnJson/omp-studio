import type { MessageEntry } from "../index.ts";
import type { slash as zhCN } from "../zh-CN/slash.ts";

export const slash = {
  treeDesc: "Open the session tree: go back to before any user message in this session",
  forkDesc: "Fork a new task from the last user message (or use “Fork from here” on any message)",
  empty: "No matching commands",
  label: "Slash commands",
  terminalOnly: "This command is only available in terminal omp",
  unknown: "omp has no /{name} command",
  sendAnyway: "Send as text anyway",
  exportDesc: "Export the conversation as an HTML file (you choose where to save it)",
  newDesc: "Start a new task draft (in the current project)",
  resumeDesc: "Resume an earlier session: open the command palette to search tasks and past sessions",
  settingsDesc: "Open settings",
  hotkeysDesc: "Show the keyboard shortcut list",
  gitDesc: "Commit the changes in this task's working directory",
  renameDesc: "Rename this task (/rename New name; without a name, edits the title in place)",
  deleteDesc: "Archive this task (undo within 8 seconds)",
  modelDesc: "Choose the model and thinking level",
  effortDesc: "Adjust the thinking level (in the model picker)",
  usageDesc: "View subscription limits and daily usage",
  contextDesc: "View context usage and breakdown",
  compactDesc: "Compact the context",
  todoDesc: "Show the todo board",
  todoEmpty: "This task has no todos yet",
  contextEmpty: "omp has not reported context usage yet",
  compactArgs: "/compact does not take extra instructions in studio; remove the text after it and send again",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
