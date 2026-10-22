import { describe, expect, it } from "vitest";
import type { DefaultModelInfo, ModelDefaults, ModelOption } from "../src/shared/ipc.ts";
import { resolveNewTaskDefault } from "../src/shared/ui/new-task-default.ts";

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

  it("模型目录还没到：占位，不显示任何模型或强度", () => {
    const result = resolveNewTaskDefault(defaults(), null, null);
    expect(result).toMatchObject({ pending: true, model: null, thinkingLevel: null });
  });

  it("这个项目的默认值还没读到：占位，不拿 omp 的全局默认值（模型、强度）顶替", () => {
    const global: DefaultModelInfo = {
      key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      name: "DeepSeek V4 Flash",
      thinkingLevel: "max",
    };
    const result = resolveNewTaskDefault(null, global, [model()]);
    expect(result).toMatchObject({ pending: true, model: null, thinkingLevel: null });
  });

  it("项目里没配模型：用 omp 自选的模型，档位用项目配的；认出来后不再占位", () => {
    const global: DefaultModelInfo = {
      key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
      name: "DeepSeek V4 Flash",
      thinkingLevel: "max",
    };
    const result = resolveNewTaskDefault(defaults({ model: null, thinkingLevel: "low" }), global, [model()]);
    expect(result).toMatchObject({ pending: false, thinkingLevel: "low" });
    expect(result.model?.name).toBe("DeepSeek V4 Flash");
  });

  it("配置指向目录里没有的模型：给出它的名字（去掉档位后缀），仍显示配置的档位", () => {
    const result = resolveNewTaskDefault(defaults({ model: "foo/bar:high" }), null, [model()]);
    expect(result).toMatchObject({ pending: false, model: null, unknownModel: "foo/bar", thinkingLevel: "high" });
  });

  it("什么都没配、omp 也没读到：没有强度", () => {
    expect(resolveNewTaskDefault(null, undefined, null).thinkingLevel).toBeNull();
  });
});
