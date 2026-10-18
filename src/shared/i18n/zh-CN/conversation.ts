import type { MessageEntry } from "../index.ts";

export const conversation = {
  compacted: "已压缩上下文",
  imageAlt: "图片",
  commandOutput: "命令输出",
  starting: "正在启动 omp…",
} satisfies Record<string, MessageEntry>;
