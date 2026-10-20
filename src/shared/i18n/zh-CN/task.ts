import type { MessageEntry } from "../index.ts";

export const task = {
  untitled: "新任务",
  forkTitle: "{title}（分叉）",
  rename: "重命名",
  renameLabel: "任务标题",
  archive: "归档",
  archived: "已归档",
  undo: "撤销",
  openFolder: "打开工作目录",
  reveal: "显示会话文件",
  copyId: "复制会话 ID",
  copyPath: "复制会话文件路径",
  stopped: "已停止",
  more: "更多操作",
  runningFor: "{n} 分钟",
  noSession: "这个任务还没有会话文件。",
  exportHtml: "导出为 HTML…",
} satisfies Record<string, MessageEntry>;
