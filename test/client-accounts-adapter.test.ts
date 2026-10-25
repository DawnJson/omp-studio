// 插件形状 → omp 形状的纯映射（src/main/client-accounts/extension/adapter.mjs）。
// 这里是登录成功后 omp 能不能正确用上模型的关键：凭据的 type 会覆盖、模型行缺字段会让 omp 退回默认值。
import { describe, expect, it } from "vitest";
import {
  OPENAI_COMPATIBLE_NPM,
  SESSION_HEADER,
  STRETCHED_EXPIRY_MS,
  modelRowFromRuntime,
  pickSignInMethod,
  stretchExpiry,
  stripType,
  supportsChatTransport,
  toPluginAuth,
} from "../src/main/client-accounts/extension/adapter.mjs";

describe("凭据", () => {
  it("摘掉插件自己的 type：否则 omp 的 {type:'oauth', ...结果} 会被写成 success，凭据库认不出来", () => {
    const stored = stripType({ type: "success", access: "a", refresh: "r", expires: 1, uid: "u1", machineId: "m1" });
    expect(stored).toEqual({ access: "a", refresh: "r", expires: 1, uid: "u1", machineId: "m1" });
    expect("type" in (stored ?? {})).toBe(false);
  });

  it("不是对象时返回 null（插件出错时不要把 undefined 存进去）", () => {
    expect(stripType(undefined)).toBeNull();
    expect(stripType("token")).toBeNull();
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

  it("选无提示的设备流；带 prompts 的 PAT 在 RPC 模式走不通（omp 拒绝 secret 提示）", () => {
    expect(pickSignInMethod([pat, device])).toBe(device);
    expect(pickSignInMethod([pat])).toBeNull();
    expect(pickSignInMethod(undefined)).toBeNull();
  });

  it("同一站点有多个无提示方式时选浏览器登录（不选读桌面版登录的那个）", () => {
    const desktop = { type: "oauth", label: "WorkBuddy desktop's sign-in", authorize: () => ({}) };
    const browser = { type: "oauth", label: "WorkBuddy account (browser)", authorize: () => ({}) };
    expect(pickSignInMethod([desktop, browser])).toBe(browser);
    expect(pickSignInMethod([desktop])).toBe(desktop);
  });
});

describe("模型行", () => {
  it("账号的模型列表：上下文、图片、思考、输出上限", () => {
    expect(
      modelRowFromRuntime({
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
    });
  });

  it("缺上下文时用 128K 兜底，小的上下文不会被输出上限撑破", () => {
    expect(modelRowFromRuntime({ id: "lite" })).toMatchObject({ contextWindow: 128_000, maxTokens: 32768 });
    expect(modelRowFromRuntime({ id: "small", limit: { context: 8_000 } })).toMatchObject({
      contextWindow: 8_000,
      maxTokens: 8_000,
    });
  });

  it("每个模型带自己的服务地址（WorkBuddy 的 chat 在 <endpoint>/v2，少了它请求打到错路径、回 200 但没有回答）", () => {
    expect(
      modelRowFromRuntime({
        id: "deepseek-v4-pro",
        api: { url: "https://copilot.tencent.com/v2", npm: OPENAI_COMPATIBLE_NPM },
      }),
    ).toMatchObject({ baseUrl: "https://copilot.tencent.com/v2" });
    expect(modelRowFromRuntime({ id: "x" })).not.toHaveProperty("baseUrl");
  });

  it("只收 OpenAI 兼容 chat 的模型；WorkBuddy 的 claude-*（Messages）先不收", () => {
    expect(supportsChatTransport({ api: { npm: OPENAI_COMPATIBLE_NPM } })).toBe(true);
    expect(supportsChatTransport({})).toBe(true);
    expect(supportsChatTransport({ api: { npm: "@ai-sdk/anthropic" } })).toBe(false);
  });

  it("会话 id 的头名和插件一致（插件靠它算 Qoder 的 session_id，不会发给厂商）", () => {
    expect(SESSION_HEADER).toBe("x-magpie-qoder-session");
  });
});

describe("凭据到期时间", () => {
  const now = 1_700_000_000_000;

  it("快到期（或没有到期时间）的推后一整天：插件就不会自己去刷一次性 refresh token", () => {
    expect(stretchExpiry({ access: "a", expires: now + 1_000 }, now)).toMatchObject({
      access: "a",
      expires: now + STRETCHED_EXPIRY_MS,
    });
    expect(stretchExpiry({ access: "a" }, now)).toMatchObject({ expires: now + STRETCHED_EXPIRY_MS });
  });

  it("本来就晚于一天的保持原值（不退回到更早）", () => {
    const far = now + 10 * 24 * 60 * 60 * 1000;
    expect(stretchExpiry({ access: "a", expires: far }, now)).toMatchObject({ expires: far });
    expect(stretchExpiry(null, now)).toBeNull();
  });

  it("交给插件的形状必须带 type: oauth（少了它插件的 loader 返回空对象，任务报“no fetch”）", () => {
    const stored = { access: "a", refresh: "r", expires: now };
    expect(toPluginAuth(stored, now)).toEqual({
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: now + STRETCHED_EXPIRY_MS,
    });
    // 存回去时再把 type 摘掉，两个方向各管一头。
    expect(stripType(toPluginAuth(stored, now))).toEqual({
      access: "a",
      refresh: "r",
      expires: now + STRETCHED_EXPIRY_MS,
    });
  });
});
