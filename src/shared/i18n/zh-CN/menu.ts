import type { MessageEntry } from "../index.ts";

export const menu = {
  newTask: "新任务",
  toggleSidebar: "切换侧栏",
  settings: "设置",
  language: "语言",
  languageSystem: "跟随系统",
  theme: "主题",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",
  helpFeedback: "帮助与反馈",
} satisfies Record<string, MessageEntry>;
