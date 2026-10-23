import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import { StartupCache } from "../src/main/service/startup-cache.ts";
import { writeFileAtomic } from "../src/main/tasks/atomic-write.ts";

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 启动缓存-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const open = (file: string, warnings: unknown[] = []) =>
  new StartupCache({
    file,
    write: (target, text) => writeFileAtomic(target, text, "test"),
    warn: (message) => warnings.push(message),
  });

const opus: ModelOption = {
  key: { provider: "anthropic", modelId: "claude-opus-5-5" },
  name: "Claude Opus 5.5",
  contextWindow: 1_000_000,
  reasoning: true,
  acceptsImages: true,
  maxTokens: 64_000,
  thinkingEfforts: ["low", "medium", "high"],
  cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  intelligence: 57.6,
  catalogTps: null,
};

describe("StartupCache（startup-cache.json）", () => {
  it("下次启动读回上次记下的各项；按项目和 provider 的记录互相合并而不是覆盖", async () => {
    const file = path.join(scratch, "a", "startup-cache.json");
    const first = open(file);
    expect(first.snapshot()).toEqual({});
    first.setDefaultModel({ key: opus.key, name: opus.name, thinkingLevel: "high" });
    first.setModels([opus]);
    first.setModelDefaults(null, { model: null, thinkingLevel: "low" });
    first.setModelDefaults("p1", { model: "anthropic/claude-opus-5-5", thinkingLevel: null });
    first.setSubscription("anthropic", true);
    first.setSubscription("openai", false);
    first.setApprovalMode("yolo");
    await first.flushed();

    const second = open(file);
    expect(second.snapshot()).toEqual({
      defaultModel: { key: opus.key, name: opus.name, thinkingLevel: "high" },
      models: [opus],
      modelDefaults: {
        global: { model: null, thinkingLevel: "low" },
        p1: { model: "anthropic/claude-opus-5-5", thinkingLevel: null },
      },
      subscriptions: { anthropic: true, openai: false },
      approvalMode: "yolo",
    });
    expect(second.model({ provider: "anthropic", modelId: "claude-opus-5-5" })?.name).toBe("Claude Opus 5.5");
    expect(second.model({ provider: "anthropic", modelId: "nope" })).toBeNull();
  });

  it("文件坏了或是别的格式版本：当成没有，不报错，下次记录照常写", async () => {
    const broken = path.join(scratch, "broken.json");
    await writeFile(broken, "{ not json", "utf8");
    expect(open(broken).snapshot()).toEqual({});

    const old = path.join(scratch, "old.json");
    await writeFile(old, JSON.stringify({ version: 0, approvalMode: "write" }), "utf8");
    const cache = open(old);
    expect(cache.snapshot()).toEqual({});
    cache.setApprovalMode("always-ask");
    await cache.flushed();
    expect(open(old).snapshot()).toEqual({ approvalMode: "always-ask" });
  });

  it("写盘失败只记 WARN，内存里的值照样可用", async () => {
    const warnings: unknown[] = [];
    // 目标是一个已存在的目录：改名会失败。
    const cache = open(scratch, warnings);
    cache.setApprovalMode("write");
    await cache.flushed();
    expect(warnings).toHaveLength(1);
    expect(cache.snapshot().approvalMode).toBe("write");
  });
});
