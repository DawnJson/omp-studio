import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchModelList, modelsUrl, resolveKeyToken } from "../src/main/omp-config/fetch-models.ts";
import { startFakeOpenAi, type FakeOpenAi } from "./fake-openai/server.ts";

let fake: FakeOpenAi;
beforeAll(async () => {
  fake = await startFakeOpenAi({ apiKey: "sk-test", models: ["fake-chat", "fake-mini", "fake-chat"] });
});
afterAll(async () => {
  await fake.close();
});

describe("一键拉取模型列表", () => {
  it("OpenAI 兼容：带 key 拉到列表（去重）", async () => {
    const result = await fetchModelList(fetch, {
      baseUrl: `${fake.baseUrl}/`,
      api: "openai-completions",
      token: "sk-test",
    });
    expect(result).toEqual({
      ok: true,
      models: [
        { id: "fake-chat", name: null },
        { id: "fake-mini", name: null },
      ],
    });
  });

  it("key 错 → unauthorized；路径错 → not-found；不通 → network", async () => {
    expect(await fetchModelList(fetch, { baseUrl: fake.baseUrl, api: "openai-completions", token: "bad" })).toEqual({
      ok: false,
      code: "unauthorized",
      status: 401,
    });
    expect(
      await fetchModelList(fetch, {
        baseUrl: fake.baseUrl.replace(/\/v1$/, "/nope"),
        api: "openai-completions",
        token: "sk-test",
      }),
    ).toEqual({ ok: false, code: "not-found", status: 404 });
    const plain = await startFakeOpenAi();
    try {
      expect(
        await fetchModelList(fetch, {
          baseUrl: plain.baseUrl.replace(/\/v1$/, "/nope"),
          api: "openai-completions",
          token: null,
        }),
      ).toEqual({ ok: false, code: "not-found", status: 404 });
    } finally {
      await plain.close();
    }
    expect(
      await fetchModelList(fetch, { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", token: null }),
    ).toEqual({
      ok: false,
      code: "network",
    });
  });

  it("超时、非 JSON、形状不对、5xx、不支持的 api、非法 URL", async () => {
    const base = { baseUrl: "http://x.example/v1", api: "openai-completions", token: null };
    const timeout = () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await fetchModelList(timeout, base)).toEqual({ ok: false, code: "timeout" });
    expect(await fetchModelList(() => Promise.resolve(new Response("<html>")), base)).toEqual({
      ok: false,
      code: "format",
    });
    expect(await fetchModelList(() => Promise.resolve(Response.json({ nothing: 1 })), base)).toEqual({
      ok: false,
      code: "format",
    });
    expect(await fetchModelList(() => Promise.resolve(new Response("", { status: 502 })), base)).toEqual({
      ok: false,
      code: "http",
      status: 502,
    });
    expect(await fetchModelList(fetch, { ...base, api: "bedrock-converse-stream" })).toEqual({
      ok: false,
      code: "unsupported",
    });
    expect(await fetchModelList(fetch, { ...base, baseUrl: "ftp://x" })).toEqual({ ok: false, code: "invalid-url" });
  });

  it("Anthropic：/v1/models + x-api-key，display_name 当名字；baseUrl 末尾 /v1 不重复", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const server = http.createServer((request, response) => {
      seen.push({ url: request.url ?? "", headers: new Headers(request.headers as Record<string, string>) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "claude-x", display_name: "Claude X", type: "model" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      for (const base of [origin, `${origin}/v1`]) {
        expect(await fetchModelList(fetch, { baseUrl: base, api: "anthropic-messages", token: "ak" })).toEqual({
          ok: true,
          models: [{ id: "claude-x", name: "Claude X" }],
        });
      }
      expect(seen.map((s) => s.url)).toEqual(["/v1/models", "/v1/models"]);
      expect(seen[0]?.headers.get("x-api-key")).toBe("ak");
      expect(seen[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
      expect(seen[0]?.headers.get("authorization")).toBeNull();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("Gemini：/models?pageSize=1000 + x-goog-api-key，去掉 models/ 前缀，只留对话模型；无效 key 的 400 算 key 被拒", async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const server = http.createServer((request, response) => {
      const headers = new Headers(request.headers as Record<string, string>);
      seen.push({ url: request.url ?? "", headers });
      if (headers.get("x-goog-api-key") !== "AIza-good") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            {
              name: "models/text-embedding-004",
              displayName: "Embedding",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`;
    try {
      expect(await fetchModelList(fetch, { baseUrl, api: "google-generative-ai", token: "AIza-good" })).toEqual({
        ok: true,
        models: [{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }],
      });
      expect(seen[0]?.url).toBe("/v1beta/models?pageSize=1000");
      expect(seen[0]?.headers.get("authorization")).toBeNull();
      expect(await fetchModelList(fetch, { baseUrl, api: "google-generative-ai", token: "AIza-bad" })).toEqual({
        ok: false,
        code: "unauthorized",
        status: 400,
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("重定向不跟随（key 不会被带到别的主机）", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:1/steal" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      expect(await fetchModelList(fetch, { baseUrl, api: "openai-completions", token: "k" })).toMatchObject({
        ok: false,
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("URL 和 key 解析", () => {
    expect(modelsUrl("https://a.example/v1", "openai-completions")).toBe("https://a.example/v1/models");
    expect(modelsUrl("https://a.example/v1", "anthropic-messages")).toBe("https://a.example/v1/models");
    expect(modelsUrl("https://a.example/proxy", "anthropic-messages")).toBe("https://a.example/proxy/v1/models");
    expect(resolveKeyToken("MY_KEY", { MY_KEY: "from-env" })).toBe("from-env");
    expect(resolveKeyToken("MY_KEY", {})).toBe("MY_KEY"); // omp：变量没设时字面量就是 token
    expect(resolveKeyToken("sk-abc", { "sk-abc": "x" })).toBe("sk-abc");
    expect(resolveKeyToken("!op read x", {})).toBeNull();
  });
});
