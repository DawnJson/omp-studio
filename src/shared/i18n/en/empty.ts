import type { MessageEntry } from "../index.ts";
import type { empty as zhCN } from "../zh-CN/empty.ts";

export const empty = {
  recent: "Recent tasks",
  fromTerminal: "From the terminal",
  chooseProject: "Choose a project folder",
  chooseProjectHint: "Or drop a folder here",
  openFolder: "Open folder…",
  loadFailed: "Could not load projects: {message}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
