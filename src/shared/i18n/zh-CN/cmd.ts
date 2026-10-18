import type { MessageEntry } from "../index.ts";

export const cmd = {
  newTask: "新任务",
  newTaskHere: "在当前项目新任务",
  openFolder: "打开文件夹…",
  settings: "设置",
  toggleSidebar: "切换侧栏",
  theme: "切换主题",
  language: "切换语言",
  model: "切换模型",
  thinking: "切换思考强度",
  compact: "压缩上下文",
  stop: "停止当前任务",
  copyLast: "复制最后一条回答",
  toggleProcess: "展开或收起最近的过程",
  jumpWaiting: "跳到等你确认的任务",
  checkUpdate: "检查 omp 更新",
  shortcuts: "快捷键",
  archive: "归档当前任务",
} satisfies Record<string, MessageEntry>;
