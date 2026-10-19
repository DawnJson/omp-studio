import type { MessageEntry } from "../index.ts";

export const slash = {
  empty: "没有匹配的命令",
  label: "斜杠命令",
  terminalOnly: "这个命令只在终端版 omp 里可用",
  unknown: "omp 里没有 /{name} 这个命令",
  sendAnyway: "仍作为文字发送",
} satisfies Record<string, MessageEntry>;
