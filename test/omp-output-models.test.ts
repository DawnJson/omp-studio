// `omp models --kind all --json` 的解析（设置 → 模型里搜索、生图、语音等角色的候选）。样本照 omp 18.12.6 实测的输出裁短（临时 PI_CODING_AGENT_DIR，2026-10-22）。
import { describe, expect, it } from "vitest";
import { parseRunnerModels } from "../src/shared/omp-output/models.ts";

const entry = (provider: string, kind: string, id: string, name: string) => ({
  provider,
  kind,
  id,
  selector: `${provider}/${id}`,
  name,
  contextWindow: null,
  maxTokens: null,
  reasoning: false,
  thinking: null,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  pricingStatus: "unknown",
});

describe("parseRunnerModels", () => {
  it("只留非对话模型，名字和 provider/id 原样保留", () => {
    const stdout = `${JSON.stringify({
      models: [
        entry("anthropic", "chat", "claude-opus-5-5", "Claude Opus 5.5"),
        entry("web", "search", "tavily", "Tavily"),
        entry("local", "tts", "kokoro", "Kokoro-82M"),
        entry("local", "tiny", "falcon-h1-90m", "Falcon H1 Tiny 90M"),
      ],
    })}\n`;
    expect(parseRunnerModels(stdout)).toEqual([
      { kind: "search", key: { provider: "web", modelId: "tavily" }, name: "Tavily" },
      { kind: "tts", key: { provider: "local", modelId: "kokoro" }, name: "Kokoro-82M" },
      { kind: "tiny", key: { provider: "local", modelId: "falcon-h1-90m" }, name: "Falcon H1 Tiny 90M" },
    ]);
  });

  it("不是预期的形状时报错，不当成没有模型", () => {
    expect(() => parseRunnerModels('{"error":"x"}')).toThrow();
  });
});
