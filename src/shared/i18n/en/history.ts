import type { MessageEntry } from "../index.ts";
import type { history as zhCN } from "../zh-CN/history.ts";

export const history = {
  untitled: "Untitled session",
  resumeFailed: "Could not resume this session: {message}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
