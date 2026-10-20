import type { MessageEntry } from "../index.ts";

// TSP 交互节点（picker、prefs、toast 等）自带的少量文案；omp 发来的文字原样显示，不在这里。
export const tspi = {
  nothingToPreview: "没有可预览的内容",
  searchPlaceholder: "搜索{noun}…",
  noYet: "还没有{noun}",
  noMatch: "没有匹配的{noun}",
  clearSearch: "清除搜索",
  retry: "重试",
  keep: "保留",
  delete: "删除",
  close: "关闭",
  countOf: "{shown} / {total}",
  searchSettings: "搜索设置",
  nothingToSet: "这里没有可设置的项",
  noSettingsMatch: "没有匹配“{query}”的设置",
  reset: "重置",
  changedFromDefault: "与默认值不同",
  changedFromDefaultTo: "与默认值不同：{value}",
  changedCount: "{count} 项与默认值不同",
  edit: "编辑…",
  notSet: "未设置",
  decrease: "减少",
  increase: "增加",
  dismiss: "关闭通知",
} satisfies Record<string, MessageEntry>;
