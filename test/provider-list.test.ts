import { describe, expect, it } from "vitest";
import { loginKind } from "../src/shared/provider-login.ts";
import { arrangeProviders, matchesProvider } from "../src/shared/ui/provider-list.ts";

const providers = [
  { id: "anthropic", name: "Anthropic (Claude Pro/Max)", authenticated: false },
  { id: "openrouter", name: "OpenRouter", authenticated: true },
  { id: "tavily", name: "Tavily", authenticated: false },
  { id: "deepseek", name: "DeepSeek", authenticated: false },
  { id: "xai-oauth", name: "xAI Grok OAuth (SuperGrok or X Premium+)", authenticated: false },
];

describe("提供商搜索", () => {
  it("按名称或 id 匹配，不区分大小写，多个词都要命中", () => {
    expect(matchesProvider({ id: "xai-oauth", name: "xAI Grok OAuth" }, "OAUTH")).toBe(true);
    expect(matchesProvider({ id: "xai-oauth", name: "xAI Grok" }, "xai-oauth")).toBe(true);
    expect(matchesProvider({ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }, "claude pro")).toBe(true);
    expect(matchesProvider({ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }, "claude tavily")).toBe(false);
    expect(matchesProvider({ id: "anthropic", name: "Anthropic" }, "   ")).toBe(true);
  });

  it("没有命中返回空列表", () => {
    expect(arrangeProviders(providers, [], "zzz")).toEqual([]);
  });
});

describe("提供商排序", () => {
  it("已认证和 studio 存了 key 的排前面，组内保持 omp 的顺序", () => {
    const ids = arrangeProviders(providers, ["deepseek"], "").map((provider) => provider.id);
    expect(ids).toEqual(["openrouter", "deepseek", "anthropic", "tavily", "xai-oauth"]);
  });

  it("先过滤再排序", () => {
    const ids = arrangeProviders(providers, ["deepseek"], "e").map((provider) => provider.id);
    expect(ids).toEqual(["openrouter", "deepseek", "anthropic", "xai-oauth"]);
    expect(arrangeProviders(providers, ["deepseek"], "deep").map((provider) => provider.id)).toEqual(["deepseek"]);
  });

  it("不改动传入的数组", () => {
    const copy = providers.map((provider) => provider.id);
    arrangeProviders(providers, ["deepseek"], "");
    expect(providers.map((provider) => provider.id)).toEqual(copy);
  });
});

describe("登录方式", () => {
  it("只认 API key 的搜索/推理服务不是 OAuth", () => {
    for (const id of ["tavily", "exa", "kagi", "parallel", "deepseek", "cerebras"])
      expect(loginKind(id), id).toBe("api-key");
  });

  it("OAuth 提供商保留登录", () => {
    for (const id of ["anthropic", "openai-codex", "google-gemini-cli", "kimi-code", "xai-oauth"])
      expect(loginKind(id), id).toBe("oauth");
  });

  it("RPC 里被 omp 拒绝的要去终端登录", () => {
    for (const id of ["github-copilot", "perplexity", "snowflake"]) expect(loginKind(id), id).toBe("terminal");
  });

  it("没见过的 provider（omp 新增）按 OAuth 处理，不藏登录入口；原型属性名不会误判", () => {
    expect(loginKind("brand-new-provider")).toBe("oauth");
    expect(loginKind("constructor")).toBe("oauth");
    expect(loginKind("__proto__")).toBe("oauth");
  });
});
