import type { MessageEntry } from "../index.ts";
import type { empty as zhCN } from "../zh-CN/empty.ts";

export const empty = {
  defaultFolder: "Default folder",
  fromTerminal: "From the terminal",
  loadFailed: "Could not load projects: {message}",
  whatsNew: "What's New",
  whatsNewUpdated: { one: "v{version} · {count} change", other: "v{version} · {count} changes" },
  whatsNewUpdatedMany: {
    one: "v{version} · {count} change across {releases} releases",
    other: "v{version} · {count} changes across {releases} releases",
  },
  whatsNewAdded: "{n} added",
  whatsNewChanged: "{n} changed",
  whatsNewFixed: "{n} fixed",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
