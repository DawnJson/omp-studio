import type { MessageEntry } from "../index.ts";
import type { menu as zhCN } from "../zh-CN/menu.ts";

export const menu = {
  newTask: "New task",
  commandPalette: "Command palette",
  settings: "Settings",
  language: "Language",
  languageSystem: "System default",
  theme: "Theme",
  themeSystem: "System default",
  themeLight: "Light",
  themeDark: "Dark",
  helpFeedback: "Help & feedback",
  about: "About omp-studio",
  quit: "Quit",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
