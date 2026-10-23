// 设置 → 模型的角色表和"编辑…"对话框：每个角色（或备用链的 key）只列它能用的模型（照 omp 18.12.6 的 MODEL_ROLES.accepts）。
import { describe, expect, it } from "vitest";
import type { ModelOption, RunnerModel } from "../src/shared/ipc.ts";
import { roleKinds } from "../src/renderer/src/features/composer/model-groups.ts";
import {
  candidatesOfKinds,
  chainKinds,
  sourcesReady,
  type ModelSources,
} from "../src/renderer/src/features/settings/role-options.ts";

const chat = (provider: string, modelId: string, name: string): ModelOption => ({
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
const runner = (kind: string, provider: string, modelId: string, name: string): RunnerModel => ({
  kind,
  key: { provider, modelId },
  name,
});

const sources: ModelSources = {
  chat: [chat("openai", "gpt-5", "GPT-5")],
  runners: [
    runner("search", "web", "tavily", "Tavily"),
    runner("tiny", "local", "falcon-h1-90m", "Falcon H1 Tiny 90M"),
    runner("image", "openai", "gpt-image-2", "GPT Image 2"),
    runner("tts", "local", "kokoro", "Kokoro-82M"),
  ],
};
const values = (role: string) => candidatesOfKinds(roleKinds(role), sources).map((candidate) => candidate.value);

describe("角色的候选模型", () => {
  it("对话角色只列对话模型；tiny 先列 tiny 模型再列对话模型；特定能力的角色只列那一类", () => {
    expect(values("smol")).toEqual(["openai/gpt-5"]);
    expect(values("writer")).toEqual(["openai/gpt-5"]);
    expect(values("tiny")).toEqual(["local/falcon-h1-90m", "openai/gpt-5"]);
    expect(values("web")).toEqual(["web/tavily"]);
    expect(values("image")).toEqual(["openai/gpt-image-2"]);
    expect(values("speech")).toEqual(["local/kokoro"]);
    expect(values("dictation")).toEqual([]);
  });

  it("非对话模型还没读到时，用得到它的角色不算齐，只用对话模型的角色不受影响", () => {
    const partial: ModelSources = { chat: sources.chat, runners: null };
    expect(sourcesReady(roleKinds("default"), partial)).toBe(true);
    expect(sourcesReady(roleKinds("tiny"), partial)).toBe(false);
    expect(sourcesReady(roleKinds("web"), partial)).toBe(false);
  });

  it("备用链的 key：角色按角色；具体模型按它的类别；provider/* 按那个 provider 有的全部类别；认不出来的当对话模型", () => {
    expect(chainKinds("web", sources)).toEqual(["search"]);
    expect(chainKinds("web/tavily", sources)).toEqual(["search"]);
    expect(chainKinds("web/*", sources)).toEqual(["search"]);
    expect(chainKinds("openai/gpt-5", sources)).toEqual(["chat"]);
    expect(chainKinds("openai/gpt-image-2", sources)).toEqual(["image"]);
    expect(chainKinds("openai/*", sources)).toEqual(["chat", "image"]);
    expect(chainKinds("anthropic/*", sources)).toEqual(["chat"]);
  });
});
