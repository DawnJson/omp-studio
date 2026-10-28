// 公开模型目录（models.dev）的汇总和查找：自定义提供商表单拿它预填 omp 认不出的模型。
import { describe, expect, it } from "vitest";
import { lookupCapabilities, summarizeCatalog } from "../src/main/omp-config/model-catalog.ts";

const model = (reasoning: boolean, input: string[], context: number) => ({
  reasoning,
  modalities: { input, output: ["text"] },
  limit: { context, output: 8192 },
});

describe("summarizeCatalog", () => {
  it("厂商自己的条目优先：转卖的服务商写得不一样也按厂商的", () => {
    const table = summarizeCatalog({
      resellerA: { models: { "moonshotai/kimi-k3.1-pro": model(false, ["text"], 131_072) } },
      resellerB: { models: { "moonshotai/kimi-k3.1-pro": model(false, ["text"], 131_072) } },
      moonshotai: { models: { "kimi-k3.1-pro": model(true, ["text", "image"], 1_048_576) } },
    });
    expect(table.get("kimi-k3.1-pro")).toEqual({ reasoning: true, images: true, contextWindow: 1_048_576 });
  });

  it("没有厂商条目时按多数：一半以上支持就算支持，上下文取出现最多的，一样多取大的", () => {
    const table = summarizeCatalog({
      a: { models: { "vendor/m1": model(true, ["text"], 200_000) } },
      b: { models: { m1: model(true, ["text", "image"], 128_000) } },
      c: { models: { M1: model(false, ["text"], 200_000) } },
      d: { models: { m2: model(true, ["text"], 100_000) } },
      e: { models: { m2: model(false, ["text", "image"], 300_000) } },
    });
    expect(table.get("m1")).toEqual({ reasoning: true, images: false, contextWindow: 200_000 });
    expect(table.get("m2")).toEqual({ reasoning: true, images: true, contextWindow: 300_000 });
  });

  it("形状不对的条目跳过，缺的上下文是 null", () => {
    const table = summarizeCatalog({
      broken: null,
      noModels: { name: "x" },
      ok: { models: { bad: null, plain: { reasoning: false } } },
    });
    expect([...table.keys()]).toEqual(["plain"]);
    expect(table.get("plain")).toEqual({ reasoning: false, images: false, contextWindow: null });
    expect(summarizeCatalog("not json object").size).toBe(0);
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
      "Relay/Kimi-K3.1-Pro": { reasoning: true, images: false, contextWindow: 1_048_576 },
    });
    // 下好之后不再下载。
    await lookupCapabilities(working, ["kimi-k3.1-pro"]);
    expect(calls).toBe(2);
  });
});
