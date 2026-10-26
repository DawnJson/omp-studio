// 插件形状 → omp 形状的纯映射（src/main/client-accounts/extension/adapter.mjs）。
// 这里是登录成功后 omp 能不能正确用上模型的关键：凭据的 type 会覆盖、模型行缺字段会让 omp 退回默认值。
import { describe, expect, it } from "vitest";
import {
  NO_EXPIRY,
  STRETCHED_EXPIRY_MS,
  defaultInputs,
  mergeCredential,
  modelRow,
  normalizeCredential,
  pickSignInMethod,
  pluginFactory,
  pluginUrl,
  toPluginAuth,
} from "../src/main/client-accounts/extension/adapter.mjs";

describe("插件导出", () => {
  it("认 makePlugin 的函数和 OpenCode v1 的 { server }，别的导出（常量、_internal）不当插件", () => {
    const fn = async () => ({});
    expect(pluginFactory(fn)).toBe(fn);
    expect(pluginFactory({ id: "x", server: fn })).toBe(fn);
    expect(pluginFactory({ typeUnions: [] })).toBeNull();
    expect(pluginFactory("x")).toBeNull();
  });
});

describe("登录方式", () => {
  const device = { type: "oauth", label: "Sign in with Qoder", authorize: () => ({}) };
  const pat = {
    type: "oauth",
    label: "Sign in with Qoder PAT",
    prompts: [{ type: "password", key: "pat" }],
    authorize: () => ({}),
  };

  it("选无提示的设备流；要打字的（PAT、手机号、域名）在 RPC 登录里收不到，不选", () => {
    expect(pickSignInMethod([pat, device])).toBe(device);
    expect(pickSignInMethod([pat])).toBeNull();
    expect(pickSignInMethod(undefined)).toBeNull();
  });

  it("同一站点有多个方式时选浏览器登录（不选读桌面版登录的那个）", () => {
    const desktop = { type: "oauth", label: "WorkBuddy desktop's sign-in", authorize: () => ({}) };
    const browser = { type: "oauth", label: "WorkBuddy account (browser)", authorize: () => ({}) };
    expect(pickSignInMethod([desktop, browser])).toBe(browser);
    expect(pickSignInMethod([desktop])).toBe(desktop);
  });

  it("只有选项的 select 提示能走，取第一个选项；不需输入的 api 方式（公共 key）也能走", () => {
    const select = {
      type: "oauth",
      label: "AutoClaw",
      prompts: [{ type: "select", key: "vendor", options: [{ value: "google" }, { value: "zai" }] }],
      authorize: () => ({}),
    };
    expect(pickSignInMethod([select])).toBe(select);
    expect(defaultInputs(select)).toEqual({ vendor: "google" });
    const free = { type: "api", label: "Free", authorize: () => ({}) };
    expect(pickSignInMethod([free])).toBe(free);
    expect(pickSignInMethod([{ type: "api", label: "Key" }])).toBeNull();
  });
});

describe("凭据", () => {
  it("摘掉插件自己的 type：否则 omp 的 {type:'oauth', ...结果} 会被写成 success，凭据库认不出来", () => {
    const stored = normalizeCredential({ type: "success", access: "a", refresh: "r", expires: 1, uid: "u1" });
    expect(stored).toEqual({ access: "a", refresh: "r", expires: 1, uid: "u1" });
    expect(normalizeCredential(undefined)).toBeNull();
  });

  it("只给 key 的 api 凭据存成 access，没有到期时间的不过期（omp 不会去刷它），交还插件时还原成 {type:'api', key}", () => {
    const stored = normalizeCredential({ type: "success", key: "k", metadata: { accountId: "1" } });
    expect(stored).toEqual({
      key: "k",
      access: "k",
      refresh: "",
      expires: NO_EXPIRY,
      studioCredential: "api",
      metadata: { accountId: "1" },
    });
    expect(toPluginAuth(stored)).toEqual({ type: "api", key: "k", metadata: { accountId: "1" } });
  });

  it("刷新结果只有变了的字段时叠在旧凭据上，账号 id、设备信息不丢", () => {
    const merged = mergeCredential({ access: "a", refresh: "r", expires: 1, uid: "u1" }, { access: "b", expires: 2 });
    expect(merged).toEqual({ access: "b", refresh: "r", expires: 2, uid: "u1" });
  });
});

describe("交给插件的凭据", () => {
  const now = 1_700_000_000_000;
  const stored = { access: "a", refresh: "r", expires: now + 1_000 };

  it("必须带 type: oauth（少了它插件的 loader 返回空对象，任务报“no fetch”）；不刷新的插件按原到期时间", () => {
    expect(toPluginAuth(stored, { now })).toEqual({ ...stored, type: "oauth" });
  });

  it("由 omp 刷新的插件：快到期的推后一天，插件就不自己刷一次性 refresh token；晚于一天的保持原值", () => {
    expect(toPluginAuth(stored, { stretch: true, now })).toMatchObject({ expires: now + STRETCHED_EXPIRY_MS });
    const far = now + 10 * STRETCHED_EXPIRY_MS;
    expect(toPluginAuth({ ...stored, expires: far }, { stretch: true, now })).toMatchObject({ expires: far });
  });
});

describe("模型行", () => {
  it("账号的模型列表：上下文、图片、思考、输出上限、传输", () => {
    expect(
      modelRow("k", {
        id: "ultimate",
        name: "Ultimate",
        limit: { context: 1_000_000 },
        capabilities: { reasoning: true, input: { image: true } },
      }),
    ).toEqual({
      id: "ultimate",
      name: "Ultimate",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 32768,
      transport: "chat",
    });
  });

  it("config 表行没有 id 时用表里的键；缺上下文用 128K 兜底，小上下文不会被输出上限撑破", () => {
    expect(modelRow("lite", {})).toMatchObject({ id: "lite", contextWindow: 128_000, maxTokens: 32768 });
    expect(modelRow("small", { limit: { context: 8_000 } })).toMatchObject({ contextWindow: 8_000, maxTokens: 8_000 });
  });

  it("按 npm 选传输：anthropic 走 Messages，openai 走 Responses；认不出的（如 google）不收", () => {
    expect(modelRow("c", { api: { npm: "@ai-sdk/anthropic" } })?.transport).toBe("messages");
    expect(modelRow("r", { api: { npm: "@ai-sdk/openai" } })?.transport).toBe("responses");
    expect(modelRow("p", {}, { npm: "@ai-sdk/anthropic" })?.transport).toBe("messages");
    expect(modelRow("g", { api: { npm: "@ai-sdk/google" } })).toBeNull();
  });

  it("每个模型带自己的服务地址（WorkBuddy 的 chat 在 <endpoint>/v2，猜站点根会 200 但没有回答），没有时用 provider 的", () => {
    expect(modelRow("d", { api: { url: "https://copilot.tencent.com/v2" } })).toMatchObject({
      baseUrl: "https://copilot.tencent.com/v2",
    });
    expect(modelRow("d", {}, { baseUrl: "https://a.example/v1" })).toMatchObject({ baseUrl: "https://a.example/v1" });
    expect(modelRow("x", {})).not.toHaveProperty("baseUrl");
  });
});

describe("请求地址", () => {
  it("Messages：omp 拼的 <站点>/v1/messages 改成插件认的 <api.url>/messages，查询串保留", () => {
    expect(pluginUrl("https://a.example/v1/messages", "messages", "https://a.example/v1")).toBe(
      "https://a.example/v1/messages",
    );
    expect(pluginUrl("https://a.example/v1/messages?beta=true", "messages", "https://a.example/api/")).toBe(
      "https://a.example/api/messages?beta=true",
    );
  });

  it("chat / Responses 两边拼法一样，原样转", () => {
    expect(pluginUrl("https://a.example/v2/chat/completions", "chat", "https://a.example/v2")).toBe(
      "https://a.example/v2/chat/completions",
    );
    expect(pluginUrl("https://a.example/v1/responses", "responses", "https://a.example/v1")).toBe(
      "https://a.example/v1/responses",
    );
  });
});
