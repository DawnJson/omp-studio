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
} satisfies Record<keyof typeof zhCN, MessageEntry>;
