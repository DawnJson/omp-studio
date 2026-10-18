import type { MessageEntry } from "../index.ts";

export const sidebar = {
  newTask: "新任务",
  waitingOne: "1 个任务在等你 · {project}",
  waitingMany: "{n} 个任务在等你",
  empty: "还没有任务",
  settings: "设置",
  palette: "命令面板",
  newInProject: "在此项目新建任务",
  label: "任务列表",
  projectMenu: "项目菜单",
  addProject: "添加项目",
  showMore: "显示更多（{n}）",
  toggleProject: "展开或收起 {project}",
  waitingHere: "有任务在等你",
  loadFailed: "任务列表加载失败：{message}",
  loading: "正在载入…",
  projectsFailed: "项目列表加载失败：{message}",
} satisfies Record<string, MessageEntry>;
