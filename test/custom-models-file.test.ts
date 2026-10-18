import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CustomProviderInput } from "../src/shared/custom-models.ts";
import {
  applyProvider,
  deleteCustomProvider,
  parseProviders,
  providerKeyValue,
  readModelsFile,
  removeProvider,
  saveCustomProvider,
} from "../src/main/omp-config/models-file.ts";

const input = (over: Partial<CustomProviderInput> = {}): CustomProviderInput => ({
  id: "my-proxy",
  baseUrl: "https://api.example.com/v1/",
  api: "openai-completions",
  key: { kind: "literal", value: "sk-secret-123" },
  models: [{ id: "gpt-x" }, { id: "gpt-y", name: "GPT Y" }],
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

describe("models.yml 编辑（纯文本）", () => {
  it("新文件：创建 providers.<id>，规范化 URL 末尾斜杠", () => {
    const text = applied(null, input());
    const parsed = parseProviders(text);
    expect(parsed.ok && parsed.providers).toEqual([
      {
        id: "my-proxy",
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        key: { kind: "literal" },
        models: [
          { id: "gpt-x", name: null },
          { id: "gpt-y", name: "GPT Y" },
        ],
        discovery: false,
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
        models: [{ id: "new-one" }, { id: "keep-me" }],
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
      input({ id: "other", key: { kind: "env", name: "MY_PROXY_KEY" }, models: [{ id: "keep-me" }] }),
      "edit",
    );
    const other = parseProviders(withEnv);
    expect(other.ok && other.providers.find((p) => p.id === "other")?.key).toEqual({
      kind: "env",
      name: "MY_PROXY_KEY",
    });
    expect(withEnv).not.toContain("auth: none");

    const none = applied(withEnv, input({ id: "other", key: { kind: "none" }, models: [{ id: "keep-me" }] }), "edit");
    expect(none).toContain("auth: none");
    expect(none).not.toContain("MY_PROXY_KEY");

    const kept = applied(existing, input({ id: "openai", key: { kind: "keep" }, models: [{ id: "m" }] }), "edit");
    expect(kept).toContain("apiKey: OPENAI_API_KEY");
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
    const parsed = parseProviders(text);
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
    ["模型 id 为空", { models: [{ id: "" }] }, "invalid-models"],
    ["模型 id 重复", { models: [{ id: "a" }, { id: "a" }] }, "invalid-models"],
    ["模型名带控制字符", { models: [{ id: "a", name: "x\ty" }] }, "invalid-models"],
    ["没有模型", { models: [] }, "needs-model"],
  ] as [string, Partial<CustomProviderInput>, string][])("拒绝：%s", (_name, over, code) => {
    expect(applyProvider(null, input(over), "add")).toEqual({ ok: false, code });
  });

  it("读：key 状态只有种类，没有内容", () => {
    const parsed = parseProviders(
      "providers:\n  a: {apiKey: sk-live-xyz, baseUrl: http://a}\n  b: {apiKey: MY_KEY}\n  c: {apiKey: '!op read x'}\n  d: {auth: none}\n",
    );
    expect(parsed.ok && parsed.providers.map((p) => p.key)).toEqual([
      { kind: "literal" },
      { kind: "env", name: "MY_KEY" },
      { kind: "command" },
      { kind: "none" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("sk-live-xyz");
    expect(providerKeyValue("providers:\n  a: {apiKey: sk-live-xyz}\n", "a")).toBe("sk-live-xyz");
    expect(providerKeyValue("providers:\n  a: {}\n", "a")).toBeNull();
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
      await saveCustomProvider(agentDir, input({ key: { kind: "keep" }, models: [{ id: "only" }] }), "edit"),
    ).toEqual({ ok: true });
    expect(await readFile(`${file}.bak`, "utf8")).toBe(first);
    expect((await readModelsFile(agentDir)).providers[0]?.models).toEqual([{ id: "only", name: null }]);

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
