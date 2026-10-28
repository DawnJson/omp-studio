import type { MessageEntry } from "../index.ts";

/** 浏览器面板（spec §4.29）。 */
export const browser = {
  panelLabel: "浏览器",
  toggle: "浏览器",
  close: "关闭浏览器",
  resize: "调整面板宽度",
  back: "后退",
  forward: "前进",
  reload: "刷新",
  stop: "停止加载",
  address: "地址",
} satisfies Record<string, MessageEntry>;
