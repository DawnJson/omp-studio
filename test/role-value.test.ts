// 防：角色值 `provider/model[:level]` 拆解时把模型 id 里的冒号当成档位，或拼接时丢掉 provider / 档位。
import { describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import { joinRoleValue, keepRoleLevel, splitRoleValue } from "../src/shared/ui/role-value.ts";

describe("splitRoleValue", () => {
  it("有 provider、无档位", () => {
    expect(splitRoleValue("anthropic/claude-opus-5-5")).toEqual({ selector: "anthropic/claude-opus-5-5", level: null });
  });

  it("有 provider、有档位：档位拆出来，选择器保留 provider 前缀", () => {
    expect(splitRoleValue("anthropic/claude-opus-5-5:xhigh")).toEqual({
      selector: "anthropic/claude-opus-5-5",
      level: "xhigh",
    });
  });

  it("模型 id 自己带冒号：最后一个冒号后不是档位就不拆", () => {
    expect(splitRoleValue("openrouter/meta/llama:free")).toEqual({
      selector: "openrouter/meta/llama:free",
      level: null,
    });
  });

  it("模型 id 带冒号又有档位：只拆最后一段", () => {
    expect(splitRoleValue("openrouter/meta/llama:free:high")).toEqual({
      selector: "openrouter/meta/llama:free",
      level: "high",
    });
  });

  it("@role 别名、没有 provider 的值、空串原样当选择器", () => {
    expect(splitRoleValue("@smol")).toEqual({ selector: "@smol", level: null });
    expect(splitRoleValue("gpt-5:low")).toEqual({ selector: "gpt-5", level: "low" });
    expect(splitRoleValue("")).toEqual({ selector: "", level: null });
    expect(splitRoleValue(":high")).toEqual({ selector: ":high", level: null });
  });
});

describe("joinRoleValue", () => {
  it("拼接和拆解互逆", () => {
    for (const value of ["a/b", "a/b:max", "a/b:c:off", "@plan"]) {
      const { selector, level } = splitRoleValue(value);
      expect(joinRoleValue(selector, level)).toBe(value);
    }
  });

  it("没有档位（null 或空串）不带冒号", () => {
    expect(joinRoleValue("a/b", null)).toBe("a/b");
    expect(joinRoleValue("a/b", "")).toBe("a/b");
  });
});

describe("keepRoleLevel", () => {
  const model = (patch: Partial<ModelOption>): ModelOption => ({
    key: { provider: "a", modelId: "b" },
    name: "B",
    contextWindow: null,
    reasoning: true,
    acceptsImages: false,
    maxTokens: null,
    thinkingEfforts: ["low", "high"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    intelligence: null,
    catalogTps: null,
    ...patch,
  });

  it("原有档位新模型也支持就保留", () => {
    expect(keepRoleLevel("x/y:high", model({}))).toBe("high");
  });

  it("新模型不支持这一档、不支持思考、原本没有档位或没有值：去掉", () => {
    expect(keepRoleLevel("x/y:xhigh", model({}))).toBeNull();
    expect(keepRoleLevel("x/y:high", model({ reasoning: false }))).toBeNull();
    expect(keepRoleLevel("x/y", model({}))).toBeNull();
    expect(keepRoleLevel(null, model({}))).toBeNull();
  });
});
