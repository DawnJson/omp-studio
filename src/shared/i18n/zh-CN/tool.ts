import type { MessageEntry } from "../index.ts";

export const tool = {
  "verb.read": "读取 {target}",
  "verb.edit": "修改 {target}",
  "verb.write": "写入 {target}",
  "verb.bash": "运行 {target}",
  "verb.search": "搜索 {target}",
  "verb.other": "调用 {tool}",
  failed: "失败",
  running: "进行中",
  "output.showAll": "显示全部",
  "output.empty": "无输出",
} satisfies Record<string, MessageEntry>;
