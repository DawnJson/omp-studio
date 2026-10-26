// 账号 provider 的模型列表缓存（src/main/client-accounts/extension/models-cache.mjs）：
// 冷启动时注册用的就是它，写坏了最坏是"首次没有模型"，但不能串到别的 provider、也不能把 token 写进去。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountModelRow } from "../src/main/client-accounts/extension/adapter.mjs";
import {
  CATALOG_TTL_MS,
  readCachedAt,
  readCachedModels,
  writeCachedModels,
} from "../src/main/client-accounts/extension/models-cache.mjs";

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp studio 模型缓存-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const row = (id: string): AccountModelRow => ({
  id,
  name: id.toUpperCase(),
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_768,
  transport: "chat",
});

describe("模型列表缓存", () => {
  it("写进去的能原样读出来，各 provider 互不覆盖，时间戳能读", async () => {
    const dir = path.join(scratch, "读写");
    writeCachedModels(dir, "qoder-cn", [row("fast"), row("kmodel")]);
    writeCachedModels(dir, "workbuddy", [row("glm-5.3")]);

    expect(readCachedModels(dir, "qoder-cn").map((item) => item.id)).toEqual(["fast", "kmodel"]);
    expect(readCachedModels(dir, "workbuddy").map((item) => item.id)).toEqual(["glm-5.3"]);
    expect(readCachedModels(dir, "qoder")).toEqual([]);
    const at = readCachedAt(dir, "qoder-cn");
    expect(Math.abs(Date.now() - at)).toBeLessThan(60_000);
  });

  it("没有目录、文件坏了、形状不对时都当没有，不抛错", async () => {
    const dir = path.join(scratch, "坏文件");
    expect(readCachedModels(dir, "qoder-cn")).toEqual([]);
    expect(readCachedAt(dir, "qoder-cn")).toBe(0);

    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "models-cache-v3.json"), "{not json", "utf8");
    expect(readCachedModels(dir, "qoder-cn")).toEqual([]);
    expect(readCachedAt(dir, "qoder-cn")).toBe(0);

    await writeFile(path.join(dir, "models-cache-v3.json"), '{"qoder-cn":{"at":"x","rows":"nope"}}', "utf8");
    expect(readCachedModels(dir, "qoder-cn")).toEqual([]);
    expect(readCachedAt(dir, "qoder-cn")).toBe(0);
  });

  it("不写 token：缓存里只有模型元数据", async () => {
    const dir = path.join(scratch, "不含凭据");
    writeCachedModels(dir, "qoder-cn", [row("fast")]);
    const text = await readFile(path.join(dir, "models-cache-v3.json"), "utf8");
    expect(text).not.toMatch(/"(access|refresh|machineId|deviceToken|pat|uid)"/);
  });

  it("刷新间隔是 6 小时（每次任务进程都拉一遍太吵）", () => {
    expect(CATALOG_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
