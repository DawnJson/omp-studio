import type { MessageEntry } from "../index.ts";

export const common = {
  cancel: "取消",
  close: "关闭",
  copy: "复制",
  copied: "已复制",
  retry: "重试",
  expand: "展开",
  collapse: "收起",
} satisfies Record<string, MessageEntry>;
