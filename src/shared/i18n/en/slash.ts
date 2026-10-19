import type { MessageEntry } from "../index.ts";
import type { slash as zhCN } from "../zh-CN/slash.ts";

export const slash = {
  empty: "No matching commands",
  label: "Slash commands",
  terminalOnly: "This command is only available in terminal omp",
  unknown: "omp has no /{name} command",
  sendAnyway: "Send as text anyway",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
