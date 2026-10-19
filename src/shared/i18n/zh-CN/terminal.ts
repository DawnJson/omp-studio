import type { MessageEntry } from "../index.ts";

export const terminal = {
  title: "终端",
  toggle: "切换终端",
  restart: "重启终端",
  hide: "隐藏终端",
  resize: "调整终端高度",
  exited: "[进程已退出，代码 {code}] 按任意键重新启动",
  restartHint: "按任意键重试",
  starting: "正在启动 shell…",
} satisfies Record<string, MessageEntry>;
