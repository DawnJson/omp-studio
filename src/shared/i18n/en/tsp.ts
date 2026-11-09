import type { MessageEntry } from "../index.ts";
import type { tsp as zhCN } from "../zh-CN/tsp.ts";

export const tsp = {
  layoutRegion: "Conversation",
  copyMarkdown: "Copy Markdown",
  copyPlainText: "Copy plain text",
  forkHere: "Fork into a new task from before this message",
  forkAfterAnswer: "Fork into a new task after this answer",
  editMessage: "Go back to before this message and edit it",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
