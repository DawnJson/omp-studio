import type { MessageEntry } from "../index.ts";
import type { dropzone as zhCN } from "../zh-CN/dropzone.ts";

export const dropzone = {
  folder: "Drop to start a task in this folder",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
