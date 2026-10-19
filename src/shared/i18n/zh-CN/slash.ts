import type { MessageEntry } from "../index.ts";

export const slash = {
  treeDesc: "打开会话树：回到这个会话里任意一条用户消息之前",
  forkDesc: "从最后一条用户消息分叉出新任务；也可以在任意消息上点“从这里分叉”",
  empty: "没有匹配的命令",
  label: "斜杠命令",
  terminalOnly: "这个命令只在终端版 omp 里可用",
  unknown: "omp 里没有 /{name} 这个命令",
  sendAnyway: "仍作为文字发送",
  exportDesc: "把对话导出为 HTML 文件（选择保存位置）",
} satisfies Record<string, MessageEntry>;
