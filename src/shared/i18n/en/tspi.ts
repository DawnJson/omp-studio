import type { MessageEntry } from "../index.ts";
import type { tspi as zhCN } from "../zh-CN/tspi.ts";

export const tspi = {
  nothingToPreview: "Nothing to preview",
  searchPlaceholder: "Search {noun}…",
  noYet: "No {noun} yet",
  noMatch: "No {noun} match",
  clearSearch: "Clear search",
  retry: "Retry",
  keep: "Keep",
  delete: "Delete",
  close: "Close",
  countOf: "{shown} of {total}",
  searchSettings: "Search settings",
  nothingToSet: "Nothing to set here",
  noSettingsMatch: "No settings match “{query}”",
  reset: "Reset",
  changedFromDefault: "Changed from default",
  changedFromDefaultTo: "Changed from default: {value}",
  changedCount: "{count} changed from default",
  edit: "Edit…",
  notSet: "Not set",
  decrease: "Decrease",
  increase: "Increase",
  dismiss: "Dismiss",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
