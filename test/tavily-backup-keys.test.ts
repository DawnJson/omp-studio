// Tavily 备用 key：扩展里包的 fetch（src/main/client-accounts/extension/tavily-keys.mjs）额度用完时换 key 重发，
// 以及主进程写的备用 key 文件（deploy.ts）。真 omp 里换 key 生效的实测见 docs/architecture/client-accounts.md。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_EXTENSION_FILES,
  countTavilyBackupKeys,
  deployAccountExtension,
  writeTavilyBackupKeys,
} from "../src/main/client-accounts/deploy.ts";
import { readBackupKeys, withBackupKeys } from "../src/main/client-accounts/extension/tavily-keys.mjs";

const SEARCH = "https://api.tavily.com/search";

/** 假 Tavily：`exhausted` 里的 key 回 432，别的回 200；记下每次请求用的 key。 */
function fakeTavily(exhausted: readonly string[]) {
  const used: string[] = [];
  const fetchImpl = async (input: unknown, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    used.push(`${String(input)} ${key}`);
    return new Response(JSON.stringify({ input, body: init?.body }), { status: exhausted.includes(key) ? 432 : 200 });
  };
  return { fetchImpl, used };
}

const post = (key: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: '{"query":"q"}',
});

describe("额度用完换 key", () => {
  it("当前 key 回 432：同一个请求按顺序换第一个没用完的备用 key 重发，请求体不变", async () => {
    const tavily = fakeTavily(["k0", "b1"]);
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1", "b2", "b3"]);

    const response = await fetch(SEARCH, post("k0"));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { body: string }).body).toBe('{"query":"q"}');
    expect(tavily.used).toEqual([`${SEARCH} k0`, `${SEARCH} b1`, `${SEARCH} b2`]);
  });

  it("换过之后 omp 还拿用完的 key 来：直接用换上的那个，不再先撞一次 432", async () => {
    const tavily = fakeTavily(["k0"]);
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1"]);
    await fetch(SEARCH, post("k0"));
    tavily.used.length = 0;

    await fetch(SEARCH, post("k0"));

    expect(tavily.used).toEqual([`${SEARCH} b1`]);
  });

  it("全都用完：每个 key 只试一次，把最后的 432 原样交给 omp 报错", async () => {
    const tavily = fakeTavily(["k0", "b1", "b2"]);
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1", "b2", "k0"]);

    const response = await fetch(SEARCH, post("k0"));

    expect(response.status).toBe(432);
    expect(tavily.used).toEqual([`${SEARCH} k0`, `${SEARCH} b1`, `${SEARCH} b2`]);
  });

  it("没用完、或者不是发给 Tavily 的请求：原样转发，不读备用 key", async () => {
    const tavily = fakeTavily(["k0"]);
    const fetch = withBackupKeys(tavily.fetchImpl, () => {
      throw new Error("should not read the backup keys");
    });

    expect((await fetch(SEARCH, post("k1"))).status).toBe(200);
    expect((await fetch("https://example.com/search", post("k0"))).status).toBe(432);
  });
});

describe("备用 key 文件", () => {
  let scratch: string;
  beforeAll(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "omp studio 备用-"));
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("主进程写、扩展读同一个文件；重新部署不删它；清空就删掉文件（路径带空格和中文）", async () => {
    const agentDir = path.join(scratch, "用户 一", "agent");
    const dir = await deployAccountExtension(agentDir, ACCOUNT_EXTENSION_FILES);
    const file = path.join(dir, "tavily-keys.json");
    expect(readBackupKeys(file)).toEqual([]);

    await writeTavilyBackupKeys(agentDir, ["b1", "b2"]);
    await deployAccountExtension(agentDir, ACCOUNT_EXTENSION_FILES);
    expect(readBackupKeys(file)).toEqual(["b1", "b2"]);
    expect(await countTavilyBackupKeys(agentDir)).toBe(2);

    await writeTavilyBackupKeys(agentDir, []);
    expect(readBackupKeys(file)).toEqual([]);
    expect(await countTavilyBackupKeys(agentDir)).toBe(0);
  });
});
