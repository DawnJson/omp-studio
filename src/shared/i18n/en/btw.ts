import type { MessageEntry } from "../index.ts";
import type { btw as zhCN } from "../zh-CN/btw.ts";

export const btw = {
  title: "Side question",
  slashDesc: "Ask a side question; the answer stays out of the conversation",
  placeholder: "Ask something on the side; it won't enter the main conversation",
  placeholderFollowUp: "Follow up on this topic",
  send: "Ask",
  cancel: "Cancel question",
  close: "Close side question",
  newTopic: "New topic",
  topics: "Side-question topics",
  "status.running": "Answering",
  "status.cancelled": "Cancelled",
  "status.error": "Error",
  "status.interrupted": "Interrupted",
  askFailed: "Couldn't ask",
  cancelFailed: "Couldn't cancel",
  cancelNothing: "There is no question to cancel",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
