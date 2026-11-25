import type { MessageEntry } from "../index.ts";

export const menu = {
  newTask: "新任务",
  toggleSidebar: "切换侧栏",
  edit: "编辑",
  undo: "撤销",
  cut: "剪切",
  copy: "复制",
  paste: "粘贴",
  selectAll: "全选",
} satisfies Record<string, MessageEntry>;
