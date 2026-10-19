import type { MessageEntry } from "../index.ts";
import type { terminal as zhCN } from "../zh-CN/terminal.ts";

export const terminal = {
  title: "Terminal",
  toggle: "Toggle terminal",
  restart: "Restart terminal",
  hide: "Hide terminal",
  resize: "Resize terminal",
  exited: "[Process exited with code {code}] Press any key to restart",
  restartHint: "Press any key to retry",
  starting: "Starting shell…",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
