import type { MessageEntry } from "../index.ts";

export const common = {
  cancel: "取消",
  close: "关闭",
  copy: "复制",
  copied: "已复制",
  retry: "重试",
  expand: "展开",
  noMatches: "没有匹配的选项",
} satisfies Record<string, MessageEntry>;
