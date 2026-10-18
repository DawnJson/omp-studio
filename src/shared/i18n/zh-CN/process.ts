import type { MessageEntry } from "../index.ts";

export const process = {
  starting: "正在启动…",
  thinking: "正在思考…",
  replying: "正在回复…",
  retrying: "模型出错，正在重试（{i}/{n}）…",
  retryingNow: "模型出错，正在重试…",
  compacting: "正在压缩上下文…",
  waiting: "等你确认 · 已暂停 {duration}",
  subagentsRunning: "{count} 个子代理",
  done: "已工作 {duration}",
  toolCalls: "{count} 次工具调用",
  subagents: "{count} 个子代理",
  failures: "{count} 次失败",
  thought: "思考 · {duration}",
  thoughtShort: "思考",
  earlier: "更早的 {n} 条",
} satisfies Record<string, MessageEntry>;
