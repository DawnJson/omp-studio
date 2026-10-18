import type { MessageEntry } from "../index.ts";

export const shortcut = {
  palette: "命令面板",
  newTask: "新任务",
  settings: "设置",
  toggleSidebar: "切换侧栏",
  send: "发送",
  newline: "换行",
  later: "运行中：稍后",
  stop: "停止并取回排队消息",
  toggleProcess: "展开或收起最近一个过程行",
  focusComposer: "聚焦输入框",
  nthTask: "切到第 N 个任务",
  prevNext: "上一个或下一个任务",
  regions: "在区域间切换",
} satisfies Record<string, MessageEntry>;
