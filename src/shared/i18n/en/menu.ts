import type { MessageEntry } from "../index.ts";
import type { menu as zhCN } from "../zh-CN/menu.ts";

export const menu = {
  newTask: "New task",
  toggleSidebar: "Toggle sidebar",
  settings: "Settings",
  language: "Language",
  languageSystem: "System default",
  theme: "Theme",
  themeSystem: "System default",
  themeLight: "Light",
  themeDark: "Dark",
  helpFeedback: "Help & feedback",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
