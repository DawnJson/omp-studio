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
  running: "Running",
  "output.showAll": "Show all",
  "output.empty": "No output",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
