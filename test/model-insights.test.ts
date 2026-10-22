// 模型选择对话框的补充参数：从 omp 的 agent.db 只读地取实测速度，从 `omp config list` 取压缩设置。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactionSettings, readModelInsights } from "../src/main/omp-config/model-insights.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-insights-"));
  const agent = new DatabaseSync(path.join(dir, "agent.db"));
  agent.exec(
    "CREATE TABLE model_perf (model_key TEXT PRIMARY KEY, samples REAL, output_tokens REAL, gen_ms REAL, ttft_samples REAL, ttft_ms REAL, updated_at INTEGER)",
  );
  agent
    .prepare("INSERT INTO model_perf VALUES (?, ?, ?, ?, ?, ?, 0)")
    .run("anthropic/opus", 183.4, 112_614, 1_635_711, 183, 577_705);
  agent.close();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const listed = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));

describe("readModelInsights", () => {
  it("实测速度只返回请求的、有采样的模型", async () => {
    const insights = await readModelInsights(
      { agentDir: dir, list: () => Promise.resolve(listed({ "compaction.thresholdPercent": 90 })), warn: () => {} },
      null,
      [
        { provider: "anthropic", modelId: "opus" },
        { provider: "openai", modelId: "gpt-5" },
      ],
    );
    expect(insights.perf["anthropic/opus"]?.samples).toBe(183);
    expect(insights.perf["anthropic/opus"]?.tokensPerSecond).toBeCloseTo(68.85, 1);
    expect(insights.perf["anthropic/opus"]?.ttftMs).toBeCloseTo(3156.9, 0);
    expect(Object.keys(insights.perf)).toEqual(["anthropic/opus"]);
    expect(insights.compaction).toMatchObject({ thresholdPercent: 90, thresholdTokens: -1, source: "global" });
  });

  it("库不存在、omp 设置读不到时各自降级，不整体失败", async () => {
    const warnings: string[] = [];
    const insights = await readModelInsights(
      {
        agentDir: path.join(dir, "missing"),
        list: () => Promise.reject(new Error("omp is not ready")),
        warn: (message) => warnings.push(message),
      },
      null,
      [{ provider: "anthropic", modelId: "opus" }],
    );
    expect(insights).toEqual({ perf: {}, compaction: null });
    expect(warnings).toHaveLength(1);
  });
});

describe("compactionSettings", () => {
  it("项目目录里读到的和全局不同就是项目设置", () => {
    const global = listed({ "compaction.thresholdPercent": 90 });
    expect(compactionSettings(listed({ "compaction.thresholdPercent": 80 }), global).source).toBe("project");
    expect(compactionSettings(listed({ "compaction.thresholdPercent": 90 }), global).source).toBe("global");
  });
});
