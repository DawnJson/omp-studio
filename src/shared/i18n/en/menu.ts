import type { MessageEntry } from "../index.ts";
import type { menu as zhCN } from "../zh-CN/menu.ts";

export const menu = {
  helpFeedback: "Help & feedback",
  about: "About omp-studio",
  quit: "Quit",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
