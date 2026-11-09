import type { MessageEntry } from "../index.ts";

// TSP 渲染器里 studio 自己的界面文案（对话区的无障碍名称、载入提示、studio 加在 omp 节点上的按钮）。
// 过程区里的内容（节点文字、"N more lines"、"No changes" 之类）不在这里：和 omp 终端一致，只有英文（features/tsp/labels.ts）。
export const tsp = {
  layoutRegion: "对话",
  copyMarkdown: "复制 Markdown",
  copyPlainText: "复制纯文本",
  forkHere: "从这条消息之前分叉出新任务",
  forkAfterAnswer: "从这条回答之后分叉出新任务",
  editMessage: "编辑这条消息（放进输入框）",
} satisfies Record<string, MessageEntry>;
