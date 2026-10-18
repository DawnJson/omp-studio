import type { MessageEntry } from "../index.ts";

export const change = {
  summary: "{count} 个文件已更改",
  more: "还有 {n} 个文件",
  copyList: "复制文件列表",
  open: "打开文件",
  reveal: "在资源管理器中显示",
  menu: "更多操作",
} satisfies Record<string, MessageEntry>;
