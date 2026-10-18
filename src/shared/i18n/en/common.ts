import type { MessageEntry } from "../index.ts";
import type { common as zhCN } from "../zh-CN/common.ts";

export const common = {
  cancel: "Cancel",
  close: "Close",
  copy: "Copy",
  copied: "Copied",
  retry: "Retry",
  expand: "Expand",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
