import type { MessageEntry } from "../index.ts";

export const tool = {
  "verb.read": "读取 {target}",
  "verb.edit": "修改 {target}",
  "verb.write": "写入 {target}",
  "verb.bash": "运行 {target}",
  "verb.search": "搜索 {target}",
  "verb.other": "调用 {tool}",
  failed: "失败",
  "info.matches": "{count} 处匹配",
  "info.files": "{count} 个文件",
  "info.agents": "{count} 个代理",
  "info.background": "后台",
  "output.more": "还有 {count} 行",
  "output.unchanged": "{count} 行未改动",
  "output.showAll": "显示全部",
  "output.empty": "无输出",
} satisfies Record<string, MessageEntry>;
