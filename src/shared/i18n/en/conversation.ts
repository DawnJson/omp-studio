import type { MessageEntry } from "../index.ts";
import type { conversation as zhCN } from "../zh-CN/conversation.ts";

export const conversation = {
  compacted: "Context compacted",
  imageAlt: "Image",
  commandOutput: "Command output",
  starting: "Starting omp…",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
