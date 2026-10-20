import type { MessageEntry } from "../index.ts";

export const empty = {
  noProject: "无项目",
  noProjectHint: "不在任何项目里：任务在一个单独的空文件夹里开始",
  fromTerminal: "来自终端",
  openFolder: "打开文件夹…",
  loadFailed: "项目列表加载失败：{message}",
  whatsNew: "最近更新",
  whatsNewUpdated: { one: "已更新到 v{version} · {count} 项改动", other: "已更新到 v{version} · {count} 项改动" },
  whatsNewUpdatedMany: {
    one: "已更新到 v{version} · {releases} 个版本共 {count} 项改动",
    other: "已更新到 v{version} · {releases} 个版本共 {count} 项改动",
  },
  whatsNewAdded: "{n} 新增",
  whatsNewChanged: "{n} 变更",
  whatsNewFixed: "{n} 修复",
} satisfies Record<string, MessageEntry>;
