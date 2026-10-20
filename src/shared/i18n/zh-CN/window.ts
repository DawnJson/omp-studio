import type { MessageEntry } from "../index.ts";

export const window = {
  about: "关于",
  runningFor: "运行中 · {time}",
} satisfies Record<string, MessageEntry>;
