import type { MessageEntry } from "../index.ts";
import type { tsp as zhCN } from "../zh-CN/tsp.ts";

export const tsp = {
  layoutRegion: "Conversation",
  copyMarkdown: "Copy Markdown",
  copyPlainText: "Copy plain text",
  nodeMenu: "Actions",
  forkHere: "Fork into a new task from before this message",
  forkAfterAnswer: "Fork into a new task after this answer",
  editMessage: "Edit this message (put it in the input box)",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
