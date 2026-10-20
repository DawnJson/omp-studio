import type { MessageEntry } from "../index.ts";
import type { empty as zhCN } from "../zh-CN/empty.ts";

export const empty = {
  noProject: "No project",
  noProjectHint: "Not in a project: the task starts in a separate empty folder",
  fromTerminal: "From the terminal",
  openFolder: "Open folder…",
  loadFailed: "Could not load projects: {message}",
  whatsNew: "What's New",
  whatsNewUpdated: { one: "Updated to v{version} · {count} change", other: "Updated to v{version} · {count} changes" },
  whatsNewUpdatedMany: {
    one: "Updated to v{version} · {count} change across {releases} releases",
    other: "Updated to v{version} · {count} changes across {releases} releases",
  },
  whatsNewAdded: "{n} added",
  whatsNewChanged: "{n} changed",
  whatsNewFixed: "{n} fixed",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
