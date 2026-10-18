import type { MessageEntry } from "../index.ts";

export const model = {
  search: "搜索模型…",
  empty: "没有可用模型",
  recent: "最近使用",
  thinking: "思考强度",
  "thinking.unsupported": "这个模型不支持思考",
  addProvider: "添加提供商…",
  switched: "切换到 {model} · {level}",
  switchedModel: "切换到 {model}",
} satisfies Record<string, MessageEntry>;
