import type { MessageEntry } from "../index.ts";

// TSP 渲染器里 studio 自己的界面文案（对话区的无障碍名称、载入提示、studio 加在 omp 节点上的按钮）。
// 过程区里的内容（节点文字、"N more lines"、"No changes" 之类）不在这里：和 omp 终端一致，只有英文（features/tsp/labels.ts）。
export const tsp = {
  layoutRegion: "对话",
  copyMarkdown: "复制 Markdown",
  copyPlainText: "复制纯文本",
  /** 节点右键菜单（actions.menu）的无障碍名称。 */
  nodeMenu: "操作",
  forkHere: "从这条消息之前分叉出新任务",
  forkAfterAnswer: "从这条回答之后分叉出新任务",
  editMessage: "编辑这条消息（放进输入框）",
  /** doc 节点（计划评审正文）：选中文字后的批注按钮、批注输入框的名称和提交按钮。 */
  docComment: "批注",
  docEditNote: "修改批注",
  docDeleteNote: "删除批注",
  /** 就地编辑时 Markdown 原文输入框的无障碍名称。 */
  docSource: "Markdown 原文",
} satisfies Record<string, MessageEntry>;
