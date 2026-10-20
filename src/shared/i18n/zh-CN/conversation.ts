import type { MessageEntry } from "../index.ts";

export const conversation = {
  imageAlt: "图片",
  commandOutput: "命令输出",
  starting: "正在启动 omp…",
  filesAttached: "已附带文件：{files}",
  todoTitle: "进度",
  "todo.pending": "未开始",
  "todo.in_progress": "进行中",
  "todo.completed": "已完成",
  "todo.blocked": "受阻",
  "todo.abandoned": "已放弃",
  "shell.stop": "停止",
  "shell.excludeUnsupported": "!! 不进入模型上下文，omp 的 RPC 还不支持；用 ! 会让模型看到输出，或到终端版里执行",
  "shell.busy": "有命令或一轮对话还在运行，等它结束（Esc 可停止）再执行新的 !命令",
  "shell.needsTask": "!命令要在任务里执行：先发一条消息创建任务，再用 !",
} satisfies Record<string, MessageEntry>;
