import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  defaultEnvName,
  isValidEnvName,
  parseTokenCount,
  type CustomModelMeta,
  type CustomProviderInput,
  type EnvSource,
} from "../src/shared/custom-models.ts";
import { envValues, removeEnvLine, setEnvLine } from "../src/main/omp-config/env-file.ts";
import {
  applyOverride,
  applyProvider,
  deleteCustomProvider,
  parseProviders,
  providerKeyValue,
  readModelsFile,
  removeProvider,
  saveCustomProvider,
  setEnvKey,
} from "../src/main/omp-config/models-file.ts";

/** 输入里的一个模型：能力参数默认全是"自动"（null）。 */
const model = (id: string, over: Partial<CustomModelMeta> & { name?: string } = {}) => ({
  id,
  reasoning: null,
  images: null,
  contextWindow: null,
  maxTokens: null,
  ...over,
});
const auto = { reasoning: null, images: null, contextWindow: null, maxTokens: null };
/** existing 里的 keep-me：界面编辑时带着文件里的 contextWindow 回来。 */
const keepMe = model("keep-me", { contextWindow: 32000 });

const input = (over: Partial<CustomProviderInput> = {}): CustomProviderInput => ({
  id: "my-proxy",
  baseUrl: "https://api.example.com/v1/",
  api: "openai-completions",
  key: { kind: "literal", value: "sk-secret-123" },
  models: [model("gpt-x"), model("gpt-y", { name: "GPT Y" })],
  ...over,
});

const existing = `# 我的模型配置
providers:
  # 内置的覆盖
  openai:
    baseUrl: https://relay.example.com/v1 # relay
    apiKey: OPENAI_API_KEY
  other:
    baseUrl: http://localhost:1234/v1
    auth: none
    api: openai-completions
    discovery:
      type: openai-models-list
    models:
      - id: keep-me
        contextWindow: 32000 # custom window
        name: Old Name
      - id: drop-me
unknownRoot: 1 # not ours
`;

function applied(text: string | null, value: CustomProviderInput, mode: "add" | "edit" = "add"): string {
  const result = applyProvider(text, value, mode);
  if (!result.ok) throw new Error(`unexpected ${result.code}`);
  return result.text;
}

/** 测试里没有任何环境变量设置。 */
const noEnv = (): EnvSource => "missing";

describe("models.yml 编辑（纯文本）", () => {
  it("新文件：创建 providers.<id>，规范化 URL 末尾斜杠", () => {
    const text = applied(null, input());
    const parsed = parseProviders(text, noEnv);
    expect(parsed.ok && parsed.providers).toEqual([
      {
        id: "my-proxy",
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        key: { kind: "literal" },
        models: [
          { id: "gpt-x", name: null, ...auto },
          { id: "gpt-y", name: "GPT Y", ...auto },
        ],
        discovery: false,
        overrides: [],
        oauthShaping: false,
      },
    ]);
  });

  it("新增保留注释、其它 provider、其它根键和条目里不认识的字段", () => {
    const text = applied(existing, input());
    expect(text).toContain("# 我的模型配置");
    expect(text).toContain("# 内置的覆盖");
    expect(text).toContain("# relay");
    expect(text).toContain("unknownRoot: 1 # not ours");
    expect(text).toContain("contextWindow: 32000 # custom window");
    expect(text.indexOf("my-proxy")).toBeGreaterThan(text.indexOf("other:"));
    // 原有内容整段保留：去掉新加的条目后和原文一致。
    expect(text.startsWith(existing.slice(0, existing.indexOf("unknownRoot")).trimEnd())).toBe(true);
  });

  it("修改：按 id 复用现有模型节点（保留 contextWindow 和注释），去掉的模型被删除，顺序按输入", () => {
    const text = applied(
      existing,
      input({
        id: "other",
        baseUrl: "http://localhost:9999/v1",
        key: { kind: "keep" },
        models: [model("new-one"), keepMe],
      }),
      "edit",
    );
    expect(text).toContain("baseUrl: http://localhost:9999/v1");
    expect(text).toContain("contextWindow: 32000 # custom window");
    expect(text).toContain("name: Old Name");
    expect(text).not.toContain("drop-me");
    expect(text.indexOf("new-one")).toBeLessThan(text.indexOf("keep-me"));
    expect(text).toContain("auth: none"); // keep 不动
    expect(text).toContain("discovery:");
    expect(text).toContain("# relay");
  });

  it("key：env 写变量名并去掉 auth: none；none 删 apiKey 并写 auth: none；keep 不动", () => {
    const withEnv = applied(
      existing,
      input({ id: "other", key: { kind: "env", name: "MY_PROXY_KEY" }, models: [keepMe] }),
      "edit",
    );
    const other = parseProviders(withEnv, noEnv);
    expect(other.ok && other.providers.find((p) => p.id === "other")?.key).toEqual({
      kind: "env",
      name: "MY_PROXY_KEY",
      source: "missing",
    });
    expect(withEnv).not.toContain("auth: none");

    const none = applied(withEnv, input({ id: "other", key: { kind: "none" }, models: [keepMe] }), "edit");
    expect(none).toContain("auth: none");
    expect(none).not.toContain("MY_PROXY_KEY");

    const kept = applied(existing, input({ id: "openai", key: { kind: "keep" }, models: [model("m")] }), "edit");
    expect(kept).toContain("apiKey: OPENAI_API_KEY");
  });

  it("anthropic-messages 保存后写 auth: apiKey（否则 omp 按订阅组装请求，cch 每次变、缓存不命中）；none / oauth 原样，别的接口不写", () => {
    // 刚由 applyProvider 输出的 YAML，形状已知。
    type AuthDoc = { providers: Record<string, { auth?: string }> };
    const authOf = (text: string, id: string) => {
      const doc = parseYaml(text) as AuthDoc;
      return doc.providers[id]?.auth;
    };
    const anthropic: Partial<CustomProviderInput> = { api: "anthropic-messages", models: [model("kimi-k3")] };
    expect(authOf(applied(null, input(anthropic)), "my-proxy")).toBe("apiKey");

    const old =
      "providers:\n  relay:\n    baseUrl: https://relay.example.com\n    apiKey: RELAY_KEY\n    api: anthropic-messages\n    models:\n      - id: kimi-k3\n";
    expect(authOf(applied(old, input({ ...anthropic, id: "relay", key: { kind: "keep" } }), "edit"), "relay")).toBe(
      "apiKey",
    );

    const none = applied(null, input({ ...anthropic, key: { kind: "none" } }));
    expect(authOf(none, "my-proxy")).toBe("none");
    expect(authOf(applied(none, input({ ...anthropic, key: { kind: "keep" } }), "edit"), "my-proxy")).toBe("none");
    const oauth = old.replace("    api:", "    auth: oauth\n    api:");
    expect(authOf(applied(oauth, input({ ...anthropic, id: "relay", key: { kind: "keep" } }), "edit"), "relay")).toBe(
      "oauth",
    );

    expect(authOf(applied(null, input()), "my-proxy")).toBeUndefined();
  });

  it("oauthShaping：只有 anthropic-messages 且没写 auth 时为 true", () => {
    const file = `providers:
  bare: { baseUrl: "https://a", apiKey: K, api: anthropic-messages, models: [{ id: m }] }
  fixed: { baseUrl: "https://a", apiKey: K, api: anthropic-messages, auth: apiKey, models: [{ id: m }] }
  free: { baseUrl: "https://a", api: anthropic-messages, auth: none, models: [{ id: m }] }
  openai: { baseUrl: "https://a", apiKey: K, api: openai-completions, models: [{ id: m }] }
`;
    const parsed = parseProviders(file, noEnv);
    expect(parsed.ok && Object.fromEntries(parsed.providers.map((p) => [p.id, p.oauthShaping]))).toEqual({
      bare: true,
      fixed: false,
      free: false,
      openai: false,
    });
  });

  it("有 discovery 的条目可以清空 models；没有的不行", () => {
    const text = applied(existing, input({ id: "other", key: { kind: "keep" }, models: [] }), "edit");
    expect(text).not.toContain("keep-me");
    expect(text).toContain("discovery:");
    expect(applyProvider(existing, input({ id: "openai", key: { kind: "keep" }, models: [] }), "edit")).toEqual({
      ok: false,
      code: "needs-model",
    });
  });

  it("自动发现：true 按接口类型写默认 discovery.type，只改这一个条目，注释和别的内容原样保留，可以不选模型", () => {
    const completions = applied(existing, input({ id: "fresh", models: [], discovery: true }));
    const entry = parseProviders(completions, noEnv);
    expect(entry.ok && entry.providers.find((p) => p.id === "fresh")).toMatchObject({ discovery: true, models: [] });
    expect(completions).toMatch(/fresh:[\s\S]*discovery:\s+type: openai-models-list/);
    // 原有内容整段保留（新条目只是追加）。
    expect(completions.startsWith(existing.slice(0, existing.indexOf("unknownRoot")).trimEnd())).toBe(true);
    expect(completions).toContain("unknownRoot: 1 # not ours");
    expect(completions).toContain("# relay");

    expect(applied(null, input({ models: [], discovery: true, api: "openai-responses" }))).toContain(
      "type: openai-models-list",
    );
    expect(applied(null, input({ models: [], discovery: true, api: "anthropic-messages" }))).toContain("type: proxy");
  });

  it("自动发现：已有 discovery（类型、timeoutMs）原样保留；false 只去掉 discovery，不动别的字段和注释", () => {
    const custom = existing.replace(
      "      type: openai-models-list",
      "      type: lm-studio # 本地\n      timeoutMs: 3000",
    );
    const kept = applied(
      custom,
      input({ id: "other", key: { kind: "keep" }, models: [keepMe], discovery: true }),
      "edit",
    );
    expect(kept).toContain("type: lm-studio # 本地");
    expect(kept).toContain("timeoutMs: 3000");

    const off = applied(
      custom,
      input({ id: "other", key: { kind: "keep" }, models: [keepMe], discovery: false }),
      "edit",
    );
    expect(off).not.toContain("discovery:");
    expect(off).not.toContain("lm-studio");
    expect(off).toContain("contextWindow: 32000 # custom window");
    expect(off).toContain("# relay");
    // 关掉自动发现、又没有模型：不能保存。
    expect(
      applyProvider(custom, input({ id: "other", key: { kind: "keep" }, models: [], discovery: false }), "edit"),
    ).toEqual({ ok: false, code: "needs-model" });
  });

  it("自动发现：没有通用发现方式的接口类型不能新写（invalid-api）", () => {
    expect(
      applyProvider(null, input({ api: "google-generative-ai", models: [model("g")], discovery: true }), "add"),
    ).toEqual({ ok: false, code: "invalid-api" });
  });

  it("能力参数：写 reasoning / input / contextWindow / maxTokens，读回来一样；omp 认的 input 写成行内列表", () => {
    const text = applied(
      null,
      input({
        models: [
          model("relay-gpt", { reasoning: true, images: true, contextWindow: 272000, maxTokens: 32000 }),
          model("plain", { reasoning: false, images: false }),
        ],
      }),
    );
    expect(text).toContain("input: [ text, image ]");
    expect(text).toContain("input: [ text ]");
    const parsed = parseProviders(text, noEnv);
    expect(parsed.ok && parsed.providers[0]?.models).toEqual([
      { id: "relay-gpt", name: null, reasoning: true, images: true, contextWindow: 272000, maxTokens: 32000 },
      { id: "plain", name: null, reasoning: false, images: false, contextWindow: null, maxTokens: null },
    ]);
  });

  it("能力参数：和文件里一样的项原样不动（写法、注释），改了的才改，null 去掉这一项", () => {
    const file = existing.replace(
      "        contextWindow: 32000 # custom window",
      "        contextWindow: 32000 # custom window\n        reasoning: true\n        input:\n          - text\n          - image # 看图",
    );
    const same = applied(
      file,
      input({
        id: "other",
        key: { kind: "keep" },
        models: [model("keep-me", { reasoning: true, images: true, contextWindow: 32000 })],
      }),
      "edit",
    );
    expect(same).toContain("- image # 看图");
    expect(same).toContain("contextWindow: 32000 # custom window");

    const changed = applied(
      file,
      input({
        id: "other",
        key: { kind: "keep" },
        models: [model("keep-me", { reasoning: null, images: true, contextWindow: 64000 })],
      }),
      "edit",
    );
    expect(changed).toContain("- image # 看图");
    expect(changed).toContain("contextWindow: 64000");
    expect(changed).not.toContain("reasoning:");

    const removed = applied(file, input({ id: "other", key: { kind: "keep" }, models: [model("keep-me")] }), "edit");
    expect(removed).not.toContain("contextWindow");
    expect(removed).not.toContain("input:");
    expect(removed).toContain("name: Old Name");
  });

  it("能力参数：文件里写的不是 omp 认的形状时读成自动，保存时不动它", () => {
    const odd = existing.replace("contextWindow: 32000 # custom window", "contextWindow: big # 手写的");
    const parsed = parseProviders(odd, noEnv);
    expect(parsed.ok && parsed.providers.find((p) => p.id === "other")?.models[0]).toMatchObject({
      contextWindow: null,
    });
    const text = applied(odd, input({ id: "other", key: { kind: "keep" }, models: [model("keep-me")] }), "edit");
    expect(text).toContain("contextWindow: big # 手写的");
  });

  it.each([
    ["272000", 272000],
    ["272,000", 272000],
    ["272k", 272000],
    ["1.05M", 1050000],
    ["1.1k", 1100],
    ["  ", null],
    ["", null],
    ["0", undefined],
    ["272.5", undefined],
    ["-5", undefined],
    ["abc", undefined],
    ["200m", undefined],
  ] as const)("token 数输入 %j → %j", (text, expected) => {
    expect(parseTokenCount(text)).toBe(expected);
  });

  it("删除只去掉这个条目", () => {
    const result = removeProvider(existing, "other");
    expect(result.ok && result.text).toContain("# 内置的覆盖");
    expect(result.ok && result.text).toContain("unknownRoot: 1 # not ours");
    expect(result.ok && result.text).not.toContain("keep-me");
    expect(result.ok && result.text).toContain("openai:");
    expect(removeProvider(existing, "nope")).toEqual({ ok: false, code: "not-found" });
    expect(removeProvider(null, "x")).toEqual({ ok: false, code: "not-found" });
  });

  it("`providers:` 为空值（只有注释）时也能新增", () => {
    const text = applied("# top\nproviders: # none yet\n", input());
    expect(text).toContain("# top");
    const parsed = parseProviders(text, noEnv);
    expect(parsed.ok && parsed.providers.map((p) => p.id)).toEqual(["my-proxy"]);
  });

  it("CRLF 文件保持 CRLF", () => {
    const crlf = existing.replace(/\n/g, "\r\n");
    const text = applied(crlf, input());
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(text).toContain("# 我的模型配置\r\n");
  });

  it("重复 id / 不存在 / 读不懂的文件", () => {
    expect(applyProvider(existing, input({ id: "openai" }), "add")).toEqual({ ok: false, code: "exists" });
    expect(applyProvider(existing, input({ id: "nope", key: { kind: "keep" } }), "edit")).toEqual({
      ok: false,
      code: "not-found",
    });
    expect(applyProvider("providers: [1, 2", input(), "add")).toEqual({ ok: false, code: "unreadable-file" });
    expect(applyProvider("- a\n- b\n", input(), "add")).toEqual({ ok: false, code: "unreadable-file" });
    expect(applyProvider("providers: 3\n", input(), "add")).toEqual({ ok: false, code: "unreadable-file" });
  });

  it.each([
    ["空 id", { id: "" }, "invalid-id"],
    ["id 带空格", { id: "a b" }, "invalid-id"],
    ["id 带路径符", { id: "a/b" }, "invalid-id"],
    ["__proto__", { id: "__proto__" }, "invalid-id"],
    ["id 过长", { id: "a".repeat(65) }, "invalid-id"],
    ["ftp URL", { baseUrl: "ftp://x.example.com" }, "invalid-url"],
    ["file URL", { baseUrl: "file:///etc/passwd" }, "invalid-url"],
    ["URL 带密码", { baseUrl: "https://u:p@x.example.com" }, "invalid-url"],
    ["不是 URL", { baseUrl: "not a url" }, "invalid-url"],
    ["未知 api", { api: "nope" }, "invalid-api"],
    ["key 为命令", { key: { kind: "literal", value: "!rm -rf /" } }, "invalid-key"],
    ["key 为空", { key: { kind: "literal", value: "  " } }, "invalid-key"],
    ["key 含换行", { key: { kind: "literal", value: "a\nb" } }, "invalid-key"],
    ["env 名非法", { key: { kind: "env", name: "1BAD" } }, "invalid-key"],
    ["新增时 keep", { key: { kind: "keep" } }, "invalid-key"],
    ["模型 id 为空", { models: [model("")] }, "invalid-models"],
    ["模型 id 重复", { models: [model("a"), model("a")] }, "invalid-models"],
    ["模型名带控制字符", { models: [model("a", { name: "x\ty" })] }, "invalid-models"],
    ["上下文为 0", { models: [model("a", { contextWindow: 0 })] }, "invalid-models"],
    ["上下文是小数", { models: [model("a", { contextWindow: 1.5 })] }, "invalid-models"],
    ["最大输出超上限", { models: [model("a", { maxTokens: 100_000_001 })] }, "invalid-models"],
    ["没有模型", { models: [] }, "needs-model"],
  ] as [string, Partial<CustomProviderInput>, string][])("拒绝：%s", (_name, over, code) => {
    expect(applyProvider(null, input(over), "add")).toEqual({ ok: false, code });
  });

  it("读：key 状态只有种类，没有内容；大小写混合的变量名只有设置了才算环境变量", () => {
    const sourceOf = (name: string): EnvSource =>
      name === "Pro_KIMI_KEY" ? "env-file" : name === "SYS_KEY" ? "system" : "missing";
    const parsed = parseProviders(
      "providers:\n  a: {apiKey: sk-live-xyz, baseUrl: http://a}\n  b: {apiKey: MY_KEY}\n  c: {apiKey: '!op read x'}\n  d: {auth: none}\n" +
        "  e: {apiKey: Pro_KIMI_KEY}\n  f: {apiKey: abcDEF123}\n  g: {apiKey: SYS_KEY}\n",
      sourceOf,
    );
    expect(parsed.ok && parsed.providers.map((p) => p.key)).toEqual([
      { kind: "literal" },
      { kind: "env", name: "MY_KEY", source: "missing" },
      { kind: "command" },
      { kind: "none" },
      { kind: "env", name: "Pro_KIMI_KEY", source: "env-file" },
      // 只由字母数字组成的真 key：没有这个变量，omp 把它当 key 用，界面也不能把它当变量名显示出来。
      { kind: "literal" },
      { kind: "env", name: "SYS_KEY", source: "system" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("abcDEF123");
    expect(JSON.stringify(parsed)).not.toContain("sk-live-xyz");
    expect(providerKeyValue("providers:\n  a: {apiKey: sk-live-xyz}\n", "a")).toBe("sk-live-xyz");
    expect(providerKeyValue("providers:\n  a: {}\n", "a")).toBeNull();
  });
});

describe("覆盖内置 provider 的条目（key + modelOverrides）", () => {
  const overrides = `providers:
  anthropic:
    # 上下文窗口
    modelOverrides:
      claude-opus-5:
        contextWindow: 1000000
      claude-sonnet-5:
        name: Sonnet (corp)
        maxTokens: 64000
      claude-named:
        name: Only a name
  other:
    baseUrl: http://localhost:1234/v1
    auth: none
    api: openai-completions
    models:
      - id: keep-me
`;
  type Doc = { providers: Record<string, Record<string, unknown>> };
  // 测试里自己写的、刚由 applyOverride 输出的 YAML，形状已知。
  const js = (text: string): Doc => parseYaml(text) as Doc;
  const meta = (patch: Partial<CustomModelMeta> = {}): CustomModelMeta => ({ ...auto, ...patch });
  // 界面打开对话框时勾着的就是文件里现有的覆盖项；不改模型时原样传回。
  const current = [
    { id: "claude-opus-5", ...meta({ contextWindow: 1000000 }) },
    { id: "claude-sonnet-5", ...meta({ maxTokens: 64000 }) },
  ];
  const saved = (text: string | null, id: string, input: Parameters<typeof applyOverride>[2]): string => {
    const result = applyOverride(text, id, input);
    if (!result.ok) throw new Error(`unexpected ${result.code}`);
    return result.text;
  };

  it("读出写了能力参数的覆盖项；只写了 name 的不算", () => {
    const parsed = parseProviders(overrides, noEnv);
    expect(parsed.ok && parsed.providers.find((p) => p.id === "anthropic")?.overrides).toEqual(current);
  });

  it("设置 key、模型不变：只加 apiKey，覆盖项、注释和别的 provider 原样", () => {
    const text = saved(overrides, "anthropic", { key: { kind: "literal", value: "sk-ant-1" }, models: current });
    expect(js(text).providers).toEqual({
      anthropic: { ...js(overrides).providers.anthropic, apiKey: "sk-ant-1" },
      other: js(overrides).providers.other,
    });
    expect(text).toContain("# 上下文窗口");
  });

  it("改上下文、加一个模型、取消一个：取消的只去掉能力参数，name 留着", () => {
    const text = saved(overrides, "anthropic", {
      key: { kind: "keep" },
      models: [
        { id: "claude-opus-5", ...meta({ contextWindow: 350000 }) },
        { id: "claude-fable-5", ...meta({ contextWindow: 350000, images: true }) },
      ],
    });
    expect(js(text).providers.anthropic).toEqual({
      modelOverrides: {
        "claude-opus-5": { contextWindow: 350000 },
        "claude-sonnet-5": { name: "Sonnet (corp)" },
        "claude-named": { name: "Only a name" },
        "claude-fable-5": { input: ["text", "image"], contextWindow: 350000 },
      },
    });
  });

  it("全部取消且没有 key：覆盖项、modelOverrides、条目依次删空", () => {
    const only =
      "providers:\n  anthropic:\n    modelOverrides:\n      claude-opus-5:\n        contextWindow: 1000000\n";
    expect(js(saved(only, "anthropic", { key: null, models: [] }))).toEqual({ providers: {} });
  });

  it("环境变量名照写；有 auth: none 时去掉它（否则 omp 不用 key）", () => {
    const other = js(saved(overrides, "other", { key: { kind: "env", name: "MY_KEY" }, models: [] })).providers.other;
    expect(other?.["apiKey"]).toBe("MY_KEY");
    expect(other).not.toHaveProperty("auth");
  });

  it("不设置 key：去掉 apiKey，覆盖项留着；条目只剩 key 时整个删掉", () => {
    const withKey = saved(overrides, "anthropic", { key: { kind: "literal", value: "sk-ant-1" }, models: current });
    expect(js(saved(withKey, "anthropic", { key: null, models: current })).providers.anthropic).toEqual(
      js(overrides).providers.anthropic,
    );
    const keyOnly = "providers:\n  anthropic:\n    apiKey: sk-ant-1\n  other:\n    auth: none\n";
    expect(js(saved(keyOnly, "anthropic", { key: null, models: [] }))).toEqual({
      providers: { other: { auth: "none" } },
    });
  });

  it("拒绝：没有这个条目、key 带换行、环境变量名不合法、模型重复或参数越界", () => {
    const keep = { kind: "keep" } as const;
    expect(applyOverride(overrides, "nope", { key: keep, models: [] })).toEqual({ ok: false, code: "not-found" });
    expect(applyOverride(null, "anthropic", { key: null, models: [] })).toEqual({ ok: false, code: "not-found" });
    expect(applyOverride(overrides, "anthropic", { key: { kind: "literal", value: "a\nb" }, models: [] })).toEqual({
      ok: false,
      code: "invalid-key",
    });
    expect(applyOverride(overrides, "anthropic", { key: { kind: "env", name: "not a name" }, models: [] })).toEqual({
      ok: false,
      code: "invalid-key",
    });
    const dup = { id: "m", ...meta() };
    expect(applyOverride(overrides, "anthropic", { key: keep, models: [dup, dup] })).toEqual({
      ok: false,
      code: "invalid-models",
    });
    expect(
      applyOverride(overrides, "anthropic", { key: keep, models: [{ id: "m", ...meta({ contextWindow: 0 }) }] }),
    ).toEqual({ ok: false, code: "invalid-models" });
  });
});

describe("models.yml 文件读写", () => {
  let scratch: string;
  let agentDir: string;
  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "omp 模型 配置-"));
    agentDir = path.join(scratch, "代理 目录", "agent");
  });
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("路径含空格和中文：新建 → 读 → 改 → 删；旧内容留 .bak", async () => {
    expect(await readModelsFile(agentDir)).toMatchObject({ exists: false, providers: [] });
    expect(await saveCustomProvider(agentDir, input(), "add")).toEqual({ ok: true });
    const file = path.join(agentDir, "models.yml");
    expect((await readModelsFile(agentDir)).providers.map((p) => p.id)).toEqual(["my-proxy"]);
    const first = await readFile(file, "utf8");

    expect(
      await saveCustomProvider(agentDir, input({ key: { kind: "keep" }, models: [model("only")] }), "edit"),
    ).toEqual({ ok: true });
    expect(await readFile(`${file}.bak`, "utf8")).toBe(first);
    expect((await readModelsFile(agentDir)).providers[0]?.models).toEqual([{ id: "only", name: null, ...auto }]);

    expect(await deleteCustomProvider(agentDir, "my-proxy")).toEqual({ ok: true });
    expect((await readModelsFile(agentDir)).providers).toEqual([]);
  });

  it("models.yml 优先于 models.yaml；只有 .yaml 时改它，不另建 .yml", async () => {
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "models.yaml"), "providers:\n  a:\n    baseUrl: http://a\n", "utf8");
    expect((await readModelsFile(agentDir)).providers.map((p) => p.id)).toEqual(["a"]);
    expect(await saveCustomProvider(agentDir, input(), "add")).toEqual({ ok: true });
    expect(await readFile(path.join(agentDir, "models.yaml"), "utf8")).toContain("my-proxy");
    await expect(readFile(path.join(agentDir, "models.yml"), "utf8")).rejects.toThrow();

    await writeFile(path.join(agentDir, "models.yml"), "providers:\n  b:\n    baseUrl: http://b\n", "utf8");
    expect((await readModelsFile(agentDir)).providers.map((p) => p.id)).toEqual(["b"]);
  });

  it("只有旧的 models.json 时不写（omp 下次启动才迁移）", async () => {
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "models.json"), "{}", "utf8");
    expect(await saveCustomProvider(agentDir, input(), "add")).toEqual({ ok: false, code: "legacy-json" });
    await expect(readFile(path.join(agentDir, "models.yml"), "utf8")).rejects.toThrow();
  });

  it("读不懂的文件：读抛错，写返回 unreadable-file 且不改文件", async () => {
    await mkdir(agentDir, { recursive: true });
    const file = path.join(agentDir, "models.yml");
    await writeFile(file, "providers: [1, 2", "utf8");
    await expect(readModelsFile(agentDir)).rejects.toThrow(/not readable/);
    expect(await saveCustomProvider(agentDir, input(), "add")).toEqual({ ok: false, code: "unreadable-file" });
    expect(await readFile(file, "utf8")).toBe("providers: [1, 2");
  });

  it("并发保存串行，不丢条目", async () => {
    const results = await Promise.all(
      ["p1", "p2", "p3", "p4"].map((id) => saveCustomProvider(agentDir, input({ id }), "add")),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await readModelsFile(agentDir)).providers.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe(".env 只改一行", () => {
  const original = '# 我的 key\r\nexport Pro_KIMI_KEY=old # 旧的\r\nOTHER="a#b"\r\n\r\nHF_TOKEN=hf\r\n';

  it("改已有的行：保留 export、CRLF、注释和别的变量", () => {
    const result = setEnvLine(original, "Pro_KIMI_KEY", "sk-new");
    expect(result).toEqual({
      ok: true,
      text: '# 我的 key\r\nexport Pro_KIMI_KEY=sk-new\r\nOTHER="a#b"\r\n\r\nHF_TOKEN=hf\r\n',
    });
  });

  it("新变量追加到末尾；值里有 # 或空格时加引号，读回来正好是这个值", () => {
    const result = setEnvLine(original, "NEW_KEY", "a b#c");
    if (!result.ok) throw new Error("unexpected");
    expect(result.text.startsWith(original)).toBe(true);
    expect(envValues(result.text)).toEqual({ Pro_KIMI_KEY: "old", OTHER: "a#b", HF_TOKEN: "hf", NEW_KEY: "a b#c" });
    expect(setEnvLine(null, "A", "x")).toEqual({ ok: true, text: "A=x\n" });
    expect(setEnvLine("A=1", "B", "2")).toEqual({ ok: true, text: "A=1\nB=2\n" });
  });

  it("同名多行只留第一行；删除删掉所有行，别的不动", () => {
    const dup = "A=1\nB=2\nA=3\n";
    expect(setEnvLine(dup, "A", "9")).toEqual({ ok: true, text: "A=9\nB=2\n" });
    expect(removeEnvLine(dup, "A")).toEqual({ ok: true, text: "B=2\n" });
    expect(removeEnvLine(original, "Pro_KIMI_KEY")).toEqual({
      ok: true,
      text: '# 我的 key\r\nOTHER="a#b"\r\n\r\nHF_TOKEN=hf\r\n',
    });
  });

  it("文件开头的 BOM（记事本另存的 UTF-8）保留，第一行的变量照样认得", () => {
    const bom = "\uFEFFA=1\nB=2\n";
    expect(setEnvLine(bom, "A", "9")).toEqual({ ok: true, text: "\uFEFFA=9\nB=2\n" });
    expect(removeEnvLine(bom, "A")).toEqual({ ok: true, text: "\uFEFFB=2\n" });
  });

  it("跨行的引号值没法只改一行：不改（别的变量会被带坏）", () => {
    const multi = 'A="line1\nline2"\nB=2\n';
    expect(setEnvLine(multi, "A", "x")).toEqual({ ok: false });
    expect(removeEnvLine(multi, "A")).toEqual({ ok: false });
  });
});

describe("环境变量形式的 key 同步 agent 目录的 .env", () => {
  let agentDir: string;
  const envFile = () => path.join(agentDir, ".env");
  beforeEach(async () => {
    agentDir = await mkdtemp(path.join(os.tmpdir(), "omp 环境 变量-"));
  });
  afterEach(async () => {
    delete process.env["STUDIO_TEST_SHADOW_KEY"];
    await rm(agentDir, { recursive: true, force: true });
  });
  const envInput = (id: string, name: string, value?: string) =>
    input({ id, key: { kind: "env", name, ...(value !== undefined && { value }) } });

  it("带值保存：.env 写这一行、models.yml 写变量名；卡片读出来是 .env 里的变量；值不经读接口返回", async () => {
    await mkdir(agentDir, { recursive: true });
    await writeFile(envFile(), "# 手写的\nOTHER=1\n", "utf8");
    expect(await saveCustomProvider(agentDir, envInput("kimi", "Pro_KIMI_KEY", "sk-kimi-1"), "add")).toEqual({
      ok: true,
    });
    expect(await readFile(envFile(), "utf8")).toBe("# 手写的\nOTHER=1\nPro_KIMI_KEY=sk-kimi-1\n");
    expect(await readFile(path.join(agentDir, "models.yml"), "utf8")).toContain("apiKey: Pro_KIMI_KEY");
    const info = await readModelsFile(agentDir);
    expect(info.providers[0]?.key).toEqual({ kind: "env", name: "Pro_KIMI_KEY", source: "env-file" });
    expect(JSON.stringify(info)).not.toContain("sk-kimi-1");

    // 更换：只改这一行；旧内容留 .env.bak。不带值 = 不动 .env。
    expect(await saveCustomProvider(agentDir, envInput("kimi", "Pro_KIMI_KEY", "sk-kimi-2"), "edit")).toEqual({
      ok: true,
    });
    expect(await readFile(envFile(), "utf8")).toBe("# 手写的\nOTHER=1\nPro_KIMI_KEY=sk-kimi-2\n");
    expect(await readFile(`${envFile()}.bak`, "utf8")).toContain("sk-kimi-1");
    expect(await saveCustomProvider(agentDir, envInput("kimi", "Pro_KIMI_KEY"), "edit")).toEqual({ ok: true });
    expect(await readFile(envFile(), "utf8")).toContain("Pro_KIMI_KEY=sk-kimi-2");
  });

  it("删除 provider、改成别的 key：没人再引用的变量从 .env 删掉；别的 provider 还在用、或内置 provider 认的变量留着", async () => {
    await saveCustomProvider(agentDir, envInput("a", "SHARED_KEY", "s"), "add");
    await saveCustomProvider(agentDir, envInput("b", "SHARED_KEY"), "add");
    await saveCustomProvider(agentDir, envInput("c", "OPENAI_API_KEY", "o"), "add");
    await saveCustomProvider(agentDir, envInput("d", "ONLY_D", "d"), "add");

    await deleteCustomProvider(agentDir, "a");
    expect(await readFile(envFile(), "utf8")).toContain("SHARED_KEY=s"); // b 还在用
    await deleteCustomProvider(agentDir, "b");
    expect(await readFile(envFile(), "utf8")).not.toContain("SHARED_KEY");
    await deleteCustomProvider(agentDir, "c");
    expect(await readFile(envFile(), "utf8")).toContain("OPENAI_API_KEY=o"); // 内置 openai 也读它
    await saveCustomProvider(agentDir, input({ id: "d", key: { kind: "literal", value: "sk-lit" } }), "edit");
    expect(await readFile(envFile(), "utf8")).not.toContain("ONLY_D");
  });

  it("系统环境变量里也有同名的：照写 .env，但告诉界面 omp 用的是系统那个", async () => {
    process.env["STUDIO_TEST_SHADOW_KEY"] = "from-system";
    expect(await saveCustomProvider(agentDir, envInput("s", "STUDIO_TEST_SHADOW_KEY", "x"), "add")).toEqual({
      ok: true,
      envShadowed: "STUDIO_TEST_SHADOW_KEY",
    });
    expect((await readModelsFile(agentDir)).providers[0]?.key).toMatchObject({ source: "system" });
  });

  it(".env 里这个变量是跨行的值：models.yml 和 .env 都不改", async () => {
    await mkdir(agentDir, { recursive: true });
    await writeFile(envFile(), 'M="a\nb"\n', "utf8");
    expect(await saveCustomProvider(agentDir, envInput("m", "M", "x"), "add")).toEqual({
      ok: false,
      code: "unsafe-env",
    });
    expect(await readFile(envFile(), "utf8")).toBe('M="a\nb"\n');
    await expect(readFile(path.join(agentDir, "models.yml"), "utf8")).rejects.toThrow();
  });

  it("拒绝：带的值有换行或以 ! 开头", async () => {
    expect(await saveCustomProvider(agentDir, envInput("x", "X_KEY", "a\nb"), "add")).toEqual({
      ok: false,
      code: "invalid-key",
    });
    expect(
      applyOverride("providers:\n  a: {modelOverrides: {}}\n", "a", {
        key: { kind: "env", name: "X", value: "!cmd" },
        models: [],
      }),
    ).toEqual({ ok: false, code: "invalid-key" });
  });

  it("内置 provider 的 key（设置 API key）：变量在 .env 里就改那一行；没在 .env 里、或系统环境变量里有，不写", async () => {
    // 变量名用测试专用的：开发机的 shell 里可能真有 TAVILY_API_KEY，那样会被当成系统环境变量。
    // 没有 .env：交给凭据库，不新建文件。
    expect(await setEnvKey(agentDir, "STUDIO_TEST_ENV_KEY", "tvly-new")).toBe(false);
    await expect(readFile(envFile(), "utf8")).rejects.toThrow();

    await writeFile(envFile(), "# 搜索\r\nexport STUDIO_TEST_ENV_KEY=tvly-old\r\nOTHER=1\r\n", "utf8");
    expect(await setEnvKey(agentDir, "STUDIO_TEST_ENV_KEY", "tvly-new")).toBe(true);
    expect(await readFile(envFile(), "utf8")).toBe("# 搜索\r\nexport STUDIO_TEST_ENV_KEY=tvly-new\r\nOTHER=1\r\n");
    expect(await readFile(`${envFile()}.bak`, "utf8")).toContain("tvly-old");
    // .env 里没有这个变量：不追加。
    expect(await setEnvKey(agentDir, "STUDIO_TEST_ENV_MISSING", "exa")).toBe(false);
    expect(await readFile(envFile(), "utf8")).not.toContain("STUDIO_TEST_ENV_MISSING");

    // 系统环境变量里也有：omp 用系统的，.env 不改。
    process.env["STUDIO_TEST_SHADOW_KEY"] = "from-system";
    await writeFile(envFile(), "STUDIO_TEST_SHADOW_KEY=old\n", "utf8");
    expect(await setEnvKey(agentDir, "STUDIO_TEST_SHADOW_KEY", "new")).toBe(false);
    expect(await readFile(envFile(), "utf8")).toBe("STUDIO_TEST_SHADOW_KEY=old\n");
  });
});

describe("按 ID 预填的环境变量名", () => {
  it("内置 provider 用 omp 自己的变量名，其余由 ID 推出且总是合法的变量名", () => {
    expect(defaultEnvName("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(defaultEnvName("my-proxy")).toBe("MY_PROXY_API_KEY");
    expect(defaultEnvName("Pro.kimi--2")).toBe("PRO_KIMI_2_API_KEY");
    expect(defaultEnvName("302ai")).toBe("_302AI_API_KEY");
    for (const id of ["302ai", "a".repeat(200), "-x-"]) expect(isValidEnvName(defaultEnvName(id))).toBe(true);
  });

  it("ID 还空着或只有符号时不预填", () => {
    expect(defaultEnvName("")).toBe("");
    expect(defaultEnvName("--")).toBe("");
  });
});
