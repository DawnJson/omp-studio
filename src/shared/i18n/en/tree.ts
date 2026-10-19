import type { MessageEntry } from "../index.ts";
import type { tree as zhCN } from "../zh-CN/tree.ts";

export const tree = {
  title: "Session tree",
  empty: "No user messages in this session yet",
  loading: "Reading the session tree…",
  imageOnly: "(image)",
  current: "Current",
  pick: "Go back to just before this message and put it in the composer",
  fork: "Fork from here",
  forkTitle: "New task that continues from just before this message; this task stays as it is",
  forkFailed: "Couldn’t fork: {message}",
  branchFailed: "Couldn’t go back to that message: {message}",
  loadFailed: "Couldn’t read the session tree: {message}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
