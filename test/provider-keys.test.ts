import { describe, expect, it } from "vitest";
import type { EnvSource } from "../src/shared/custom-models.ts";
import { isProviderKeyEnv, providerKeyEnv } from "../src/shared/provider-keys.ts";

const sources =
  (set: Record<string, EnvSource>) =>
  (name: string): EnvSource =>
    set[name] ?? "missing";

describe("providerKeyEnv：omp 实际取 key 的变量", () => {
  it("主名没设、fallback 写在 .env：用 fallback（omp 18.12.6 实测 HF_TOKEN 在 .env 时 omp token huggingface 回它）", () => {
    expect(providerKeyEnv("huggingface", sources({ HF_TOKEN: "env-file" }))).toEqual({
      name: "HF_TOKEN",
      source: "env-file",
    });
  });

  it("主名和 fallback 都设了：主名优先，不管它设在系统还是 .env", () => {
    expect(providerKeyEnv("huggingface", sources({ HUGGINGFACE_HUB_TOKEN: "env-file", HF_TOKEN: "system" }))).toEqual({
      name: "HUGGINGFACE_HUB_TOKEN",
      source: "env-file",
    });
  });

  it("都没设：回主名 missing；没有 key 变量的 provider 回 null", () => {
    expect(providerKeyEnv("huggingface", sources({}))).toEqual({ name: "HUGGINGFACE_HUB_TOKEN", source: "missing" });
    expect(providerKeyEnv("github-copilot", sources({}))).toBeNull();
  });

  it("fallback 名也算内置 provider 的 key 变量（自定义 provider 不再引用时 .env 里不能删）", () => {
    expect(isProviderKeyEnv("HF_TOKEN")).toBe(true);
    expect(isProviderKeyEnv("KIMI_API_KEY")).toBe(true);
  });
});
