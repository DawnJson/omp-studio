import { describe, expect, it } from "vitest";
import type { ModelDefaults, ModelOption } from "../src/shared/ipc.ts";
import { resolveNewTaskDefault } from "../src/renderer/src/features/composer/new-task-resolve.ts";

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

const defaults = (patch: Partial<ModelDefaults> = {}): ModelDefaults => ({
  model: "deepseek/deepseek-v4-flash",
  thinkingLevel: "high",
  storage: "global",
  ...patch,
});

describe("resolveNewTaskDefault", () => {
  it("认出模型：按模型档位钳制（medium → low）", () => {
    const result = resolveNewTaskDefault(defaults({ thinkingLevel: "medium" }), null, [model()]);
    expect(result.thinkingLevel).toBe("low");
    expect(result.levels).toEqual(["low", "high", "max"]);
  });

  it("不支持思考的模型：没有档位、强度为 null", () => {
    const result = resolveNewTaskDefault(defaults(), null, [model({ reasoning: false })]);
    expect(result.levels).toEqual([]);
    expect(result.thinkingLevel).toBeNull();
  });

  it("项目的 modelRoles.default 指向目录里没有的模型：模型认不出，仍显示配置的档位", () => {
    const result = resolveNewTaskDefault(defaults({ model: "foo/bar" }), null, [model()]);
    expect(result.model).toBeNull();
    expect(result.thinkingLevel).toBe("high");
  });

  it("模型目录还没到：显示配置的档位", () => {
    expect(resolveNewTaskDefault(defaults(), null, null).thinkingLevel).toBe("high");
  });

  it("什么都没配、omp 也没读到：没有强度", () => {
    expect(resolveNewTaskDefault(null, undefined, null).thinkingLevel).toBeNull();
  });
});
