// wire 类型 ↔ ipc.ts 契约类型的小转换。
import type { ModelOption } from "../../shared/ipc.ts";
import type { ModelInfo } from "../../shared/omp-wire/rpc-wire.generated.ts";

export function toModelOption(info: ModelInfo): ModelOption {
  return {
    key: { provider: info.provider, modelId: info.id },
    name: info.name,
    contextWindow: info.contextWindow,
    reasoning: info.reasoning,
    acceptsImages: info.input.includes("image"),
    maxTokens: info.maxTokens,
    thinkingEfforts: info.thinking ? [...info.thinking.efforts] : null,
    cost: {
      input: info.cost.input,
      output: info.cost.output,
      cacheRead: info.cost.cacheRead,
      cacheWrite: info.cost.cacheWrite,
    },
  };
}

/** 会话标题：首条用户消息的第一行，截到 60 个字符。 */
export function titleFromPrompt(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  return Array.from(firstLine.trim()).slice(0, 60).join("");
}
