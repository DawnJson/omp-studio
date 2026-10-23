// 防的是：模型多的时候搜索找不到、列表错乱，或者常用的模型在搜索时还把列表顶部占着；@ 角色搜索认错角色。
import { describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import {
  filterRoles,
  groupModels,
  parseRoleSelector,
  pinnedKeys,
  providerCounts,
  roleView,
} from "../src/renderer/src/features/composer/model-groups.ts";

const make = (provider: string, modelId: string, name = modelId): ModelOption => ({
  key: { provider, modelId },
  name,
  contextWindow: null,
  reasoning: false,
  acceptsImages: false,
  maxTokens: null,
  thinkingEfforts: null,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  intelligence: null,
  catalogTps: null,
});
const models = [
  make("openai", "gpt-5", "GPT-5"),
  make("anthropic", "claude-sonnet", "Claude Sonnet"),
  make("anthropic", "claude-haiku", "Claude Haiku"),
  make("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash"),
];

describe("groupModels", () => {
  it("没有常用时全部按 provider、名称排序", () => {
    const rows = groupModels(models, "", []);
    expect(rows.pinned).toEqual([]);
    expect(rows.rest.map((m) => m.name)).toEqual(["Claude Haiku", "Claude Sonnet", "DeepSeek V4 Flash", "GPT-5"]);
    expect(rows.flat).toHaveLength(4);
  });

  it("没有搜索词时常用的置顶（按传入顺序），且不在其余里重复出现", () => {
    const rows = groupModels(models, "", [
      { provider: "openai", modelId: "gpt-5" },
      { provider: "anthropic", modelId: "claude-sonnet" },
    ]);
    expect(rows.pinned.map((m) => m.name)).toEqual(["GPT-5", "Claude Sonnet"]);
    expect(rows.rest.map((m) => m.name)).not.toContain("GPT-5");
    expect(rows.flat.map((m) => m.name)).toEqual(["GPT-5", "Claude Sonnet", "Claude Haiku", "DeepSeek V4 Flash"]);
  });

  it("搜索同时匹配名称、provider 和 id，搜索时不再单列常用", () => {
    expect(groupModels(models, "ANTHROPIC", []).flat).toHaveLength(2);
    expect(groupModels(models, "v4-flash", []).flat.map((m) => m.name)).toEqual(["DeepSeek V4 Flash"]);
    const rows = groupModels(models, "gpt", [{ provider: "openai", modelId: "gpt-5" }]);
    expect(rows.pinned).toEqual([]);
    expect(rows.rest[0]?.name).toBe("GPT-5");
    expect(groupModels(models, "nope", []).flat).toEqual([]);
  });

  it("选了提供商只列它的模型、不单列常用，搜索也只在它里面找；左栏的提供商和表里分组同序", () => {
    const pinned = [{ provider: "openai", modelId: "gpt-5" }];
    const rows = groupModels(models, "", pinned, "anthropic");
    expect(rows.pinned).toEqual([]);
    expect(rows.flat.map((m) => m.name)).toEqual(["Claude Haiku", "Claude Sonnet"]);
    expect(groupModels(models, "gpt", pinned, "anthropic").flat).toEqual([]);
    expect(groupModels(models, "sonnet", pinned, "anthropic").flat.map((m) => m.name)).toEqual(["Claude Sonnet"]);
    expect(providerCounts(models)).toEqual([
      { provider: "anthropic", count: 2 },
      { provider: "deepseek", count: 1 },
      { provider: "openai", count: 1 },
    ]);
  });
});

describe("pinnedKeys", () => {
  it("当前模型在最前，然后是角色绑定的、最近用过的；去重", () => {
    const sonnet = models[1];
    const keys = pinnedKeys(
      { provider: "openai", modelId: "gpt-5" },
      [sonnet, null, models[0]],
      [
        { provider: "deepseek", modelId: "deepseek-v4-flash" },
        { provider: "anthropic", modelId: "claude-sonnet" },
      ],
    );
    expect(keys.map((key) => key.modelId)).toEqual(["gpt-5", "claude-sonnet", "deepseek-v4-flash"]);
  });
});

describe("filterRoles", () => {
  const tabs = ["default", "smol", "slow", "plan"];
  it("不是 @ 开头为 null；@ 单独列出全部角色；@ 之后按名字包含过滤", () => {
    expect(filterRoles(tabs, "gpt")).toBeNull();
    expect(filterRoles(tabs, "@")).toEqual(tabs);
    expect(filterRoles(tabs, "@sl")).toEqual(["slow"]);
    expect(filterRoles(tabs, " @PL")).toEqual(["plan"]);
    expect(filterRoles(tabs, "@zzz")).toEqual([]);
  });
});

describe("角色", () => {
  it("选择器去掉思考后缀，别名和不带 provider 的形式不是模型", () => {
    expect(parseRoleSelector("anthropic/claude-sonnet:high")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet",
    });
    expect(parseRoleSelector("openrouter/x/y")).toEqual({ provider: "openrouter", modelId: "x/y" });
    expect(parseRoleSelector("@smol")).toBeNull();
    expect(parseRoleSelector("plain")).toBeNull();
  });

  it("标签 = omp 的对话角色 + 指到列表中模型的自定义角色；特定能力的角色不进标签；徽标按标签顺序挂到模型上", () => {
    const view = roleView(
      {
        task: "openai/gpt-5:low",
        default: "openai/gpt-5",
        writer: "anthropic/claude-sonnet",
        web: "web/tavily",
        // judge 也收对话模型，但它是特定能力的角色：不进选择器的标签，也不给模型挂徽标
        judge: "anthropic/claude-haiku",
        smol: "gone/model",
      },
      models,
    );
    expect(view.tabs).toEqual([
      "default",
      "smol",
      "slow",
      "vision",
      "plan",
      "commit",
      "tiny",
      "memory",
      "task",
      "advisor",
      "widget",
      "writer",
    ]);
    expect(view.badges.get("m:openai/gpt-5")).toEqual(["default", "task"]);
    expect(view.badges.get("m:anthropic/claude-sonnet")).toEqual(["writer"]);
    expect(view.badges.get("m:anthropic/claude-haiku")).toBeUndefined();
    expect(view.modelOf["smol"]).toBeNull();
    expect(view.modelOf["task"]?.name).toBe("GPT-5");
  });
});
