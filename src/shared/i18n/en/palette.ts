import type { MessageEntry } from "../index.ts";
import type { palette as zhCN } from "../zh-CN/palette.ts";

export const palette = {
  label: "Command palette",
  placeholder: "Search tasks or commands…",
  recent: "Recent tasks",
  tasks: "Tasks",
  sessions: "Sessions",
  commands: "Commands",
  slash: "Slash commands",
  noResults: "No matches for “{q}”",
  askNew: "Ask in a new task",
  hint: "↑↓ Select　↵ Run　Esc Close",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
