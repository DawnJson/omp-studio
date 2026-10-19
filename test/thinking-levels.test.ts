import { describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import type { ThinkingLevel } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { modelRowMeta } from "../src/renderer/src/features/composer/model-groups.ts";
import {
  clampThinkingLevel,
  nextThinkingLevel,
  stepThinkingLevel,
  thinkingLevelOptions,
} from "../src/renderer/src/features/composer/thinking-levels.ts";

const model = (patch: Partial<ModelOption> = {}): ModelOption => ({
  key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
  name: "DeepSeek V4 Flash",
  contextWindow: 1_000_000,
  reasoning: true,
  acceptsImages: false,
  maxTokens: null,
  thinkingEfforts: ["low", "high", "max"],
  cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
  ...patch,
});

describe("thinkingLevelOptions", () => {
  it("草稿：只列模型 thinking.efforts，按强弱排序，不含 off", () => {
    expect(thinkingLevelOptions(model({ thinkingEfforts: ["max", "low", "high"] }), [])).toEqual([
      "low",
      "high",
      "max",
    ]);
  });
  it("草稿：omp 没给思考配置时退回全部 effort", () => {
    expect(thinkingLevelOptions(model({ thinkingEfforts: null }), [])).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
  it("任务：用 omp 报告的列表（含 off）原样，丢掉 inherit", () => {
    const live: ThinkingLevel[] = ["off", "low", "high", "max"];
    expect(thinkingLevelOptions(model(), live)).toEqual(live);
    expect(thinkingLevelOptions(model(), ["inherit", "low"])).toEqual(["low"]);
  });
  it("不支持思考的模型或没有模型：没有档位", () => {
    expect(thinkingLevelOptions(model({ reasoning: false }), ["off", "low"])).toEqual([]);
    expect(thinkingLevelOptions(null, [])).toEqual([]);
  });
});

describe("clampThinkingLevel（真实 omp 18.12.2 的实测：efforts low/high/max）", () => {
  const supported: ThinkingLevel[] = ["low", "high", "max"];
  it("支持的档位不变", () => {
    expect(clampThinkingLevel("high", supported)).toBe("high");
  });
  it("minimal→low，medium→low，xhigh→high（一样近取较低）", () => {
    expect(clampThinkingLevel("minimal", supported)).toBe("low");
    expect(clampThinkingLevel("medium", supported)).toBe("low");
    expect(clampThinkingLevel("xhigh", supported)).toBe("high");
  });
  it("没有可选档位或不是 effort：null", () => {
    expect(clampThinkingLevel("low", [])).toBeNull();
    expect(clampThinkingLevel("off", supported)).toBeNull();
  });
});

describe("Alt T 轮换和方向键用同一份列表、同一个顺序", () => {
  const levels: ThinkingLevel[] = ["off", "low", "high", "max"];
  it("依次走完整个列表再回到开头", () => {
    const seen: ThinkingLevel[] = [];
    let current: ThinkingLevel | null = "off";
    for (let i = 0; i < levels.length; i++) {
      current = nextThinkingLevel(levels, current);
      seen.push(current as ThinkingLevel);
    }
    expect(seen).toEqual(["low", "high", "max", "off"]);
  });
  it("当前档不在列表里：从第一档开始；空列表：null", () => {
    expect(nextThinkingLevel(levels, "minimal")).toBe("off");
    expect(nextThinkingLevel(levels, null)).toBe("off");
    expect(nextThinkingLevel([], "low")).toBeNull();
  });
  it("方向键到头循环，顺序和 Alt T 一致", () => {
    expect(stepThinkingLevel(levels, "max", 1)).toBe("off");
    expect(stepThinkingLevel(levels, "off", -1)).toBe("max");
    expect(stepThinkingLevel(levels, "low", 1)).toBe(nextThinkingLevel(levels, "low"));
  });
});

describe("modelRowMeta", () => {
  it("上下文窗口 · 输入/输出价格", () => {
    expect(modelRowMeta(model())).toBe("1M · $0.3/$1.2");
  });
  it("免费或未标价不显示价格，没有窗口就省略窗口", () => {
    expect(modelRowMeta(model({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }))).toBe("1M");
    expect(modelRowMeta(model({ contextWindow: null }))).toBe("$0.3/$1.2");
  });
});
