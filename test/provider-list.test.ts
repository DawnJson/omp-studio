import { describe, expect, it } from "vitest";
import { acceptsApiKey } from "../src/shared/provider-keys.ts";
import { loginKind } from "../src/shared/provider-login.ts";
import { accountSummary, matchesProvider, splitProviders } from "../src/shared/ui/provider-list.ts";

const providers = [
  { id: "anthropic", name: "Anthropic (Claude Pro/Max)", authenticated: false },
  { id: "openrouter", name: "OpenRouter", authenticated: true },
  { id: "tavily", name: "Tavily", authenticated: false },
  { id: "deepseek", name: "DeepSeek", authenticated: true },
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

  it("没有命中两组都是空的", () => {
    expect(splitProviders(providers, "zzz")).toEqual({ configured: [], others: [] });
  });
});

describe("提供商分组", () => {
  const ids = (list: readonly { id: string }[]) => list.map((provider) => provider.id);

  it("omp 报已认证的分到已配置，组内保持 omp 的顺序", () => {
    const { configured, others } = splitProviders(providers, "");
    expect(ids(configured)).toEqual(["openrouter", "deepseek"]);
    expect(ids(others)).toEqual(["anthropic", "tavily", "xai-oauth"]);
  });

  it("先过滤再分组", () => {
    const filtered = splitProviders(providers, "e");
    expect(ids(filtered.configured)).toEqual(["openrouter", "deepseek"]);
    expect(ids(filtered.others)).toEqual(["anthropic", "xai-oauth"]);
    const deep = splitProviders(providers, "deep");
    expect([...ids(deep.configured), ...ids(deep.others)]).toEqual(["deepseek"]);
  });

  it("不改动传入的数组", () => {
    const copy = providers.map((provider) => provider.id);
    splitProviders(providers, "");
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

  it("RPC 里被 omp 拒绝的（多步交互登录）走应用内终端登录", () => {
    for (const id of ["github-copilot", "perplexity", "snowflake"]) expect(loginKind(id), id).toBe("terminal");
  });

  it("没见过的 provider（omp 新增）按 OAuth 处理，不藏登录入口；原型属性名不会误判", () => {
    expect(loginKind("brand-new-provider")).toBe("oauth");
    expect(loginKind("constructor")).toBe("oauth");
    expect(loginKind("__proto__")).toBe("oauth");
  });
});

describe("能填 API key 的 provider", () => {
  it("有 key 环境变量的、登录就是粘贴 key 的都能填；纯 OAuth 和原型属性名不能", () => {
    for (const id of ["anthropic", "openai", "deepseek", "tavily", "exa"]) expect(acceptsApiKey(id), id).toBe(true);
    for (const id of ["xai-oauth", "github-copilot", "constructor", "__proto__"])
      expect(acceptsApiKey(id), id).toBe(false);
  });
});

describe("卡片上的账号名", () => {
  it("内部编号（UUID、长十六进制、omp 起的 credential / API key 序号）不写；邮箱、用户名照写", () => {
    expect(accountSummary(["01a17524-0c51-7591-a331-6707fcc0a1b2"])).toBe("");
    expect(accountSummary(["OAuth credential #9"])).toBe("");
    expect(accountSummary(["API key #6"])).toBe("");
    expect(accountSummary(["9f86d081884c7d659a2feaa0c55ad015"])).toBe("");
    expect(accountSummary(["me@example.com (me)"])).toBe("me@example.com (me)");
    expect(accountSummary(["用户6184715810"])).toBe("用户6184715810");
    expect(accountSummary([])).toBe("");
  });

  it("多个账号：取第一个能读的，+N 数的是其余全部账号", () => {
    expect(accountSummary(["OAuth credential #1", "b@example.com", "c@example.com"])).toBe("b@example.com +2");
    expect(accountSummary(["a@example.com", "API key #2"])).toBe("a@example.com +1");
  });
});
