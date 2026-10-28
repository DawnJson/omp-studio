import type { MessageEntry } from "../index.ts";

export const goal = {
  title: "目标",
  slashDesc: "设定目标，omp 持续推进直到完成",
  pause: "暂停",
  resume: "继续",
  drop: "放弃",
  completed: "目标已完成",
  cmdPause: "暂停目标",
  cmdResume: "继续目标",
  cmdDrop: "放弃目标",
  "status.active": "进行中",
  "status.paused": "已暂停",
  "status.budget-limited": "预算用尽",
  usageTitle: "已用 {used} tokens",
  usageBudgetTitle: "已用 {used} / 预算 {budget} tokens",
  current: "当前目标（{status}）：{objective}",
  none: "当前没有目标。用 /goal 加上目标文字来设定一个",
  pauseFailed: "暂停目标失败",
  resumeFailed: "继续目标失败",
  dropFailed: "放弃目标失败",
} satisfies Record<string, MessageEntry>;
