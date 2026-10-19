// 防的是：模型多的时候搜索找不到、分组错乱，或者最近使用的模型在搜索时还把列表顶部占着。
import { describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import { groupModels, treeItems } from "../src/renderer/src/features/composer/model-groups.ts";

const make = (provider: string, modelId: string, name = modelId): ModelOption => ({
  key: { provider, modelId },
  name,
  contextWindow: null,
  reasoning: false,
  acceptsImages: false,
  maxTokens: null,
  thinkingEfforts: null,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const models = [
  make("openai", "gpt-5", "GPT-5"),
  make("anthropic", "claude-sonnet", "Claude Sonnet"),
  make("anthropic", "claude-haiku", "Claude Haiku"),
  make("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash"),
];

describe("groupModels", () => {
  it("按 provider 分组，组内按名称排序", () => {
    const rows = groupModels(models, "", []);
    expect(rows.groups.map((g) => g.provider)).toEqual(["anthropic", "deepseek", "openai"]);
    expect(rows.groups[0]?.models.map((m) => m.name)).toEqual(["Claude Haiku", "Claude Sonnet"]);
    expect(rows.flat).toHaveLength(4);
  });

  it("没有搜索词时最近用过的置顶，且不在分组里重复出现", () => {
    const rows = groupModels(models, "", [{ provider: "openai", modelId: "gpt-5" }]);
    expect(rows.recent.map((m) => m.name)).toEqual(["GPT-5"]);
    expect(rows.groups.map((g) => g.provider)).not.toContain("openai");
    expect(rows.flat[0]?.name).toBe("GPT-5");
  });

  it("搜索同时匹配名称、provider 和 id，搜索时不再单列最近", () => {
    expect(groupModels(models, "ANTHROPIC", []).flat).toHaveLength(2);
    expect(groupModels(models, "v4-flash", []).flat.map((m) => m.name)).toEqual(["DeepSeek V4 Flash"]);
    const rows = groupModels(models, "gpt", [{ provider: "openai", modelId: "gpt-5" }]);
    expect(rows.recent).toEqual([]);
    expect(rows.groups[0]?.models[0]?.name).toBe("GPT-5");
    expect(groupModels(models, "nope", []).flat).toEqual([]);
  });
});

describe("treeItems", () => {
  it("组默认只有组头；展开的组跟着它的模型；最近用过的在最前面；组头标出当前模型所在的组", () => {
    const rows = groupModels(models, "", [{ provider: "openai", modelId: "gpt-5" }]);
    const current = { provider: "anthropic", modelId: "claude-haiku" };
    const collapsed = treeItems(rows, () => false, current);
    expect(collapsed.map((item) => item.id)).toEqual(["m:openai/gpt-5", "g:anthropic", "g:deepseek"]);
    expect(collapsed[1]).toMatchObject({ kind: "group", count: 2, expanded: false, hasCurrent: true });
    const open = treeItems(rows, (provider) => provider === "anthropic", current);
    expect(open.map((item) => item.id)).toEqual([
      "m:openai/gpt-5",
      "g:anthropic",
      "m:anthropic/claude-haiku",
      "m:anthropic/claude-sonnet",
      "g:deepseek",
    ]);
  });
});
