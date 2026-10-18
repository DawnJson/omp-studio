import type { MessageEntry } from "../index.ts";

export const empty = {
  recent: "最近的任务",
  fromTerminal: "来自终端",
  chooseProject: "选择项目文件夹",
  chooseProjectHint: "或把文件夹拖到这里",
  openFolder: "打开文件夹…",
  loadFailed: "项目列表加载失败：{message}",
} satisfies Record<string, MessageEntry>;
