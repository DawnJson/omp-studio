import type { MessageEntry } from "../index.ts";
import type { tool as zhCN } from "../zh-CN/tool.ts";

export const tool = {
  "verb.read": "Reading {target}",
  "verb.edit": "Editing {target}",
  "verb.write": "Writing {target}",
  "verb.bash": "Running {target}",
  "verb.search": "Searching {target}",
  "verb.other": "Calling {tool}",
  failed: "Failed",
  "info.matches": { one: "{count} match", other: "{count} matches" },
  "info.files": { one: "{count} file", other: "{count} files" },
  "info.agents": { one: "{count} agent", other: "{count} agents" },
  "info.background": "background",
  "output.more": { one: "{count} more line", other: "{count} more lines" },
  "output.unchanged": { one: "{count} unchanged line", other: "{count} unchanged lines" },
  "output.showAll": "Show all",
  "output.empty": "No output",
  "output.collapse": "Collapse",
  "info.readFiles": { one: "{count} file", other: "{count} files" },
} satisfies Record<keyof typeof zhCN, MessageEntry>;
