import type { MessageEntry } from "../index.ts";

export const empty = {
  defaultFolder: "默认文件夹",
  fromTerminal: "来自终端",
  loadFailed: "项目列表加载失败：{message}",
  whatsNew: "最近更新",
  whatsNewUpdated: { one: "v{version} · {count} 项改动", other: "v{version} · {count} 项改动" },
  whatsNewUpdatedMany: {
    one: "v{version} · {releases} 个版本共 {count} 项改动",
    other: "v{version} · {releases} 个版本共 {count} 项改动",
  },
  whatsNewAdded: "{n} 新增",
  whatsNewChanged: "{n} 变更",
  whatsNewFixed: "{n} 修复",
  title: "开始一个任务",
  usageTitle: "本周用量",
  usageToday: "今天 {value}",
  usageNoDatabase: "暂无用量",
  usageChart: "近 {weeks} 周每天的 token 用量：本周 {week}，今天 {today}",
  usageLoading: "正在读取用量",
} satisfies Record<string, MessageEntry>;
