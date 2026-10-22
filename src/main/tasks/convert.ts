// wire 类型 ↔ ipc.ts 契约类型的小转换。
import type { ModelOption } from "../../shared/ipc.ts";
import type { ModelInfo } from "../../shared/omp-wire/rpc-wire.generated.ts";

/**
 * get_available_models 发的是 omp 的完整 Model（实测 omp 18.12.6）：除了 wire 类型的 ModelInfo 列出的字段，还有 omp 按跨 provider
 * 的写法补好的目录分数 `int`（智能分）和 `tps`（输出速度，0 表示没测过）。没有或不是有限数时当作没有。
 */
type ModelInfoWithMetrics = ModelInfo & { int?: unknown; tps?: unknown };

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function toModelOption(info: ModelInfoWithMetrics): ModelOption {
  const tps = finiteNumber(info.tps);
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
    intelligence: finiteNumber(info.int),
    catalogTps: tps !== null && tps > 0 ? tps : null,
  };
}

/** 会话标题：首条用户消息的第一行，截到 60 个字符。 */
export function titleFromPrompt(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  return Array.from(firstLine.trim()).slice(0, 60).join("");
}
