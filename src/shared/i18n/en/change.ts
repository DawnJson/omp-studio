import type { MessageEntry } from "../index.ts";
import type { change as zhCN } from "../zh-CN/change.ts";

export const change = {
  summary: { one: "{count} file changed", other: "{count} files changed" },
  more: "{n} more files",
  copyList: "Copy file list",
  open: "Open file",
  reveal: "Show in folder",
  menu: "More actions",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
