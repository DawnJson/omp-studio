import type { MessageEntry } from "../index.ts";

export const palette = {
  label: "命令面板",
  placeholder: "搜索任务或命令…",
  recent: "最近任务",
  tasks: "任务",
  sessions: "会话",
  commands: "命令",
  slash: "斜杠命令",
  noResults: "无匹配",
  askNew: "在新任务中提问",
} satisfies Record<string, MessageEntry>;
