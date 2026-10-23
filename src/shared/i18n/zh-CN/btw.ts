import type { MessageEntry } from "../index.ts";

export const btw = {
  title: "旁路提问",
  slashDesc: "问一个旁路问题，回答不进对话流",
  placeholder: "问点别的，回答不会进入主对话",
  placeholderFollowUp: "追问这个话题",
  send: "提问",
  cancel: "取消提问",
  close: "关闭旁路提问",
  newTopic: "新话题",
  copyAnswer: "复制答案",
  topics: "旁路提问的话题",
  "status.running": "回答中",
  "status.cancelled": "已取消",
  "status.error": "出错",
  "status.interrupted": "已中断",
  askFailed: "提问失败",
  cancelFailed: "取消失败",
  cancelNothing: "没有可取消的提问",
} satisfies Record<string, MessageEntry>;
