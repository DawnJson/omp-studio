import type { MessageEntry } from "../index.ts";

// TSP 渲染器里 studio 自己的界面文案（对话区的无障碍名称、载入提示）。
// 过程区里的内容（节点文字、"N more lines"、"No changes" 之类）不在这里：和 omp 终端一致，只有英文（features/tsp/labels.ts）。
export const tsp = {
  layoutRegion: "对话",
} satisfies Record<string, MessageEntry>;
