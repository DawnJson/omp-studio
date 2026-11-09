import { describe, expect, it } from "vitest";
import type { ModelOption, TaskThinkingLevel } from "../src/shared/ipc.ts";
import {
  modelContextCell,
  modelPriceCell,
  modelPriceLine,
} from "../src/renderer/src/features/composer/model-groups.ts";
import { nextThinkingLevel } from "../src/renderer/src/features/composer/thinking-levels.ts";
import { clampThinkingLevel, thinkingLevelOptions } from "../src/shared/ui/new-task-default.ts";

const model = (patch: Partial<ModelOption> = {}): ModelOption => ({
  key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
  name: "DeepSeek V4 Flash",
  contextWindow: 1_000_000,
  reasoning: true,
  acceptsImages: false,
  maxTokens: null,
  thinkingEfforts: ["low", "high", "max"],
  cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
  intelligence: null,
  catalogTps: null,
  ...patch,
});

describe("thinkingLevelOptions", () => {
  it("草稿：auto 在前，再按强弱列模型 thinking.efforts，不含 off", () => {
    expect(thinkingLevelOptions(model({ thinkingEfforts: ["max", "low", "high"] }), null)).toEqual([
      "auto",
      "low",
      "high",
      "max",
    ]);
  });
  it("草稿：omp 没给思考配置时退回全部 effort", () => {
    expect(thinkingLevelOptions(model({ thinkingEfforts: null }), null)).toEqual([
      "auto",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
  it("任务：用 omp 报告的列表（含 auto、off），按界面顺序", () => {
    expect(thinkingLevelOptions(model(), ["off", "low", "auto", "high", "max"])).toEqual([
      "auto",
      "off",
      "low",
      "high",
      "max",
    ]);
  });
  it("任务：omp 没报出档位时就是没有，不退回全部 effort（选了会被 omp 拒绝）", () => {
    expect(thinkingLevelOptions(model({ thinkingEfforts: null }), [])).toEqual([]);
    expect(thinkingLevelOptions(model(), [])).toEqual([]);
  });
  it("不支持思考的模型或没有模型：没有档位", () => {
    expect(thinkingLevelOptions(model({ reasoning: false }), ["off", "low"])).toEqual([]);
    expect(thinkingLevelOptions(null, null)).toEqual([]);
  });
});

describe("clampThinkingLevel（真实 omp 18.12.2 的实测：efforts low/high/max）", () => {
  const supported: TaskThinkingLevel[] = ["low", "high", "max"];
  it("支持的档位不变", () => {
    expect(clampThinkingLevel("high", supported)).toBe("high");
  });
  it("minimal→low，medium→low，xhigh→high（一样近取较低）", () => {
    expect(clampThinkingLevel("minimal", supported)).toBe("low");
    expect(clampThinkingLevel("medium", supported)).toBe("low");
    expect(clampThinkingLevel("xhigh", supported)).toBe("high");
  });
  it("auto、off：模型支持就原样保留", () => {
    expect(clampThinkingLevel("auto", ["auto", ...supported])).toBe("auto");
    expect(clampThinkingLevel("off", ["off", ...supported])).toBe("off");
  });
  it("没有可选档位或不是 effort：null", () => {
    expect(clampThinkingLevel("low", [])).toBeNull();
    expect(clampThinkingLevel("off", supported)).toBeNull();
    expect(clampThinkingLevel("auto", supported)).toBeNull();
  });
});

describe("Alt T 轮换", () => {
  const levels: TaskThinkingLevel[] = ["auto", "off", "low", "high", "max"];
  it("依次走完整个列表（auto 也是一档）再回到开头", () => {
    const seen: TaskThinkingLevel[] = [];
    let current: TaskThinkingLevel | null = "auto";
    for (let i = 0; i < levels.length; i++) {
      current = nextThinkingLevel(levels, current);
      seen.push(current as TaskThinkingLevel);
    }
    expect(seen).toEqual(["off", "low", "high", "max", "auto"]);
  });
  it("当前档不在列表里：从第一档开始；空列表：null", () => {
    expect(nextThinkingLevel(levels, "minimal")).toBe("auto");
    expect(nextThinkingLevel(levels, null)).toBe("auto");
    expect(nextThinkingLevel([], "low")).toBeNull();
  });
});

describe("表格单元格", () => {
  const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  it("上下文窗口、价格列 $输入·输出、参数行 $输入/输出", () => {
    expect(modelContextCell(model())).toBe("1M");
    expect(modelPriceCell(model())).toBe("$0.3·1.2");
    expect(modelPriceLine(model())).toBe("$0.3/1.2");
  });
  it("免费或未标价、没有窗口都是 null（界面显示 –）", () => {
    expect(modelPriceCell(model({ cost: free }))).toBeNull();
    expect(modelPriceLine(model({ cost: free }))).toBeNull();
    expect(modelContextCell(model({ contextWindow: null }))).toBeNull();
  });
});
