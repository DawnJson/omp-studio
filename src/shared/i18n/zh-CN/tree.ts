import type { MessageEntry } from "../index.ts";

export const tree = {
  title: "会话树",
  empty: "这个会话里还没有用户消息",
  loading: "正在读取会话树…",
  imageOnly: "（图片）",
  current: "当前",
  pick: "回到这条消息之前，并把它放进输入框",
  fork: "从这里分叉",
  forkTitle: "新建任务，从这条消息之前接着聊；原任务不变",
  summarize: "回溯时让 omp 摘要被放弃的分支",
  summarizeHint: "回到这条消息之前时，让 omp 先把被放弃的那条分支写成一段摘要留在会话里（会调用一次模型）",
  summarizing: "正在摘要…",
  forking: "正在分叉…",
  forkFailed: "分叉失败：{message}",
  branchFailed: "回到这条消息失败：{message}",
  loadFailed: "读取会话树失败：{message}",
} satisfies Record<string, MessageEntry>;
