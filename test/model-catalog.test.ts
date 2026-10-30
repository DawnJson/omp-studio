// 公开模型目录（models.dev）的汇总和查找：自定义提供商表单拿它预填 omp 认不出的模型、认出生图模型。
import { describe, expect, it } from "vitest";
import { lookupCapabilities, summarizeCatalog } from "../src/main/omp-config/model-catalog.ts";
import { catalogSaysImage, type ModelCapabilities } from "../src/shared/custom-models.ts";

const model = (reasoning: boolean, input: string[], context: number, output = ["text"]) => ({
  reasoning,
  modalities: { input, output },
  limit: { context, output: 8192 },
});
const textOut = { outputsImage: false, imageOnly: false };

describe("summarizeCatalog", () => {
  it("厂商自己的条目优先：转卖的服务商写得不一样也按厂商的", () => {
    const table = summarizeCatalog({
      resellerA: { models: { "moonshotai/kimi-k3.1-pro": model(false, ["text"], 131_072) } },
      resellerB: { models: { "moonshotai/kimi-k3.1-pro": model(false, ["text"], 131_072) } },
      moonshotai: { models: { "kimi-k3.1-pro": model(true, ["text", "image"], 1_048_576) } },
    });
    expect(table.get("kimi-k3.1-pro")).toEqual({ reasoning: true, images: true, contextWindow: 1_048_576, ...textOut });
  });

  it("没有厂商条目时按多数：一半以上支持就算支持，上下文取出现最多的，一样多取大的", () => {
    const table = summarizeCatalog({
      a: { models: { "vendor/m1": model(true, ["text"], 200_000) } },
      b: { models: { m1: model(true, ["text", "image"], 128_000) } },
      c: { models: { M1: model(false, ["text"], 200_000) } },
      d: { models: { m2: model(true, ["text"], 100_000) } },
      e: { models: { m2: model(false, ["text", "image"], 300_000) } },
    });
    expect(table.get("m1")).toEqual({ reasoning: true, images: false, contextWindow: 200_000, ...textOut });
    expect(table.get("m2")).toEqual({ reasoning: true, images: true, contextWindow: 300_000, ...textOut });
  });

  it("形状不对的条目跳过，缺的上下文是 null", () => {
    const table = summarizeCatalog({
      broken: null,
      noModels: { name: "x" },
      ok: { models: { bad: null, plain: { reasoning: false } } },
    });
    expect([...table.keys()]).toEqual(["plain"]);
    expect(table.get("plain")).toEqual({ reasoning: false, images: false, contextWindow: null, ...textOut });
    expect(summarizeCatalog("not json object").size).toBe(0);
  });

  it("生图专用：只出图，或标了 type: image 又没有上下文窗口；又出文字又出图、有上下文的是对话模型；按多数合并", () => {
    const typed = (context: number, output: string[]) => ({
      type: "image",
      ...model(false, ["text", "image"], context, output),
    });
    const table = summarizeCatalog({
      // OpenAI 自己的 gpt-image-1.5 写的是文字加图片（models.dev 2026-10-30）。
      openai: { models: { "gpt-image-1.5": typed(0, ["text", "image"]), "gpt-image-2": typed(0, ["image"]) } },
      openrouter: { models: { "openai/gpt-5-image": typed(400_000, ["image", "text"]) } },
      google: { models: { "gemini-2.5-flash-image": typed(32_768, ["text", "image"]) } },
      a: { models: { "x/flux-2": model(false, ["text"], 0, ["image"]) } },
      b: { models: { "flux-2": model(false, ["text"], 0, ["image"]) } },
      c: { models: { "flux-2": model(false, ["text"], 0, ["text"]) } },
    });
    for (const id of ["gpt-image-1.5", "gpt-image-2", "flux-2"])
      expect(table.get(id)).toMatchObject({ outputsImage: true, imageOnly: true });
    for (const id of ["gpt-5-image", "gemini-2.5-flash-image"])
      expect(table.get(id)).toMatchObject({ outputsImage: true, imageOnly: false });
  });
});

describe("catalogSaysImage", () => {
  const caps = (outputsImage: boolean, imageOnly: boolean): ModelCapabilities => ({
    reasoning: false,
    images: false,
    contextWindow: null,
    outputsImage,
    imageOnly,
  });
  it("OpenAI 兼容只认生图专用的；Gemini 出图就算；不能生图的接口一律不算", () => {
    for (const api of ["openai-completions", "openai-responses"]) {
      expect(catalogSaysImage(api, caps(true, true))).toBe(true);
      // gpt-5-image 这类是对话模型；gemini-*-image 走 OpenAI 兼容接口时也不当生图（omp 会请求 /images/generations）。
      expect(catalogSaysImage(api, caps(true, false))).toBe(false);
      expect(catalogSaysImage(api, caps(false, false))).toBe(false);
    }
    expect(catalogSaysImage("google-generative-ai", caps(true, false))).toBe(true);
    expect(catalogSaysImage("google-generative-ai", caps(true, true))).toBe(true);
    expect(catalogSaysImage("google-generative-ai", caps(false, false))).toBe(false);
    for (const api of ["anthropic-messages", "azure-openai-responses", "bedrock-converse-stream"])
      expect(catalogSaysImage(api, caps(true, true))).toBe(false);
  });
});

describe("lookupCapabilities", () => {
  it("按 id 的最后一段、不分大小写查，原样作键返回；下载失败返回空，下次再下", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      return new Response("nope", { status: 503 });
    };
    expect(await lookupCapabilities(failing, ["kimi-k3.1-pro"])).toEqual({});
    const body = JSON.stringify({ moonshotai: { models: { "kimi-k3.1-pro": model(true, ["text"], 1_048_576) } } });
    const working = async () => {
      calls++;
      return new Response(body, { status: 200 });
    };
    expect(await lookupCapabilities(working, ["Relay/Kimi-K3.1-Pro", "unknown-model"])).toEqual({
      "Relay/Kimi-K3.1-Pro": { reasoning: true, images: false, contextWindow: 1_048_576, ...textOut },
    });
    // 下好之后不再下载。
    await lookupCapabilities(working, ["kimi-k3.1-pro"]);
    expect(calls).toBe(2);
  });
});
