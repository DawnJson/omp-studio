import type { MessageEntry } from "../index.ts";

export const tabs = {
  label: "任务标签",
  close: "关闭标签",
  closeRunningTitle: "关闭标签？",
  closeRunningBody: "「{title}」还在运行，关闭标签会停止它。",
  closeManyRunningBody: "其中 {count} 个任务还在运行，关闭标签会停止它们。",
  closeRunningConfirm: "停止并关闭",
  menu: "标签菜单",
  rename: "重命名",
  color: "颜色",
  colorNone: "无颜色",
  colorN: "颜色 {n}",
  closeOthers: "关闭其他标签",
  closeRight: "关闭右侧标签",
  closeAll: "全部关闭",
} satisfies Record<string, MessageEntry>;
