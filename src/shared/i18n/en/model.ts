import type { MessageEntry } from "../index.ts";
import type { model as zhCN } from "../zh-CN/model.ts";

export const model = {
  search: "Search models…",
  empty: "No models available",
  recent: "Recent",
  thinking: "Thinking",
  "thinking.unsupported": "This model doesn't support thinking",
  addProvider: "Add a provider…",
  switched: "Switched to {model} · {level}",
  switchedModel: "Switched to {model}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
