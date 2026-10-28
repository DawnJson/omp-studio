// Tavily 备用 key：扩展在 omp 进程里请求失败时当场换 key 重发、把换上的 key 写进 `.env`（src/main/client-accounts/extension/tavily-keys.mjs），
// 设置页列出的每个 key 的用量（src/main/tavily/key-usage.ts）。真 omp 里的实测见 docs/architecture/login.md「Tavily 备用 key」。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rotateStoredKey, withBackupKeys } from "../src/main/client-accounts/extension/tavily-keys.mjs";
import { fetchKeyUsage, usageFromReply } from "../src/main/tavily/key-usage.ts";

const SEARCH = "https://api.tavily.com/search";

/** 假 Tavily：每个 key 回什么状态（没列的回 200）；记下每次请求用的 key 和请求体。 */
function fakeTavily(statuses: Record<string, number>) {
  const used: string[] = [];
  const bodies: unknown[] = [];
  const fetchImpl = async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const headers = request?.headers ?? new Headers(init?.headers);
    const key = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    used.push(key);
    bodies.push(request ? await request.text() : init?.body);
    return new Response("{}", { status: statuses[key] ?? 200 });
  };
  return { fetchImpl, used, bodies };
}

const post = (key: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: '{"query":"q"}',
});

describe("请求失败时当场换 key（扩展）", () => {
  it("当前 key 用完（432）：同一个请求按顺序换第一个能用的备用 key 重发，请求体不变，omp 拿到正常结果", async () => {
    const tavily = fakeTavily({ k0: 432, b1: 433 });
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1", "b2", "b3"]);

    const response = await fetch(SEARCH, post("k0"));

    expect(response.status).toBe(200);
    expect(tavily.used).toEqual(["k0", "b1", "b2"]);
    expect(tavily.bodies).toEqual(Array(3).fill('{"query":"q"}'));
  });

  it("换过之后 omp 还拿用完的 key 来：直接用换上的那个，不再先撞一次", async () => {
    const tavily = fakeTavily({ k0: 432 });
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1"]);
    await fetch(SEARCH, post("k0"));
    tavily.used.length = 0;

    await fetch(SEARCH, post("k0"));

    expect(tavily.used).toEqual(["b1"]);
  });

  it("无效 key（401）也换；被限流（429）这次换别的 key，之后照旧先用它", async () => {
    const invalid = fakeTavily({ k0: 401 });
    expect((await withBackupKeys(invalid.fetchImpl, () => ["b1"])(SEARCH, post("k0"))).status).toBe(200);
    expect(invalid.used).toEqual(["k0", "b1"]);

    const statuses: Record<string, number> = { k0: 429 };
    const limited = fakeTavily(statuses);
    const fetch = withBackupKeys(limited.fetchImpl, () => ["b1"]);
    expect((await fetch(SEARCH, post("k0"))).status).toBe(200);
    delete statuses["k0"];
    await fetch(SEARCH, post("k0"));
    expect(limited.used).toEqual(["k0", "b1", "k0"]);
  });

  it("URL 对象和 Request 形式的请求同样换 key 重发", async () => {
    const tavily = fakeTavily({ k0: 432 });
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1"]);

    expect((await fetch(new URL(SEARCH), post("k0"))).status).toBe(200);
    expect((await fetch(new Request(SEARCH, post("k0")))).status).toBe(200);
    expect(tavily.used).toEqual(["k0", "b1", "b1"]);
    expect(tavily.bodies.at(-1)).toBe('{"query":"q"}');
  });

  it("全都用完：每个 key 只试一次，把最后的错误原样交给 omp", async () => {
    const tavily = fakeTavily({ k0: 432, b1: 432, b2: 429 });
    const fetch = withBackupKeys(tavily.fetchImpl, () => ["b1", "b2", "k0"]);

    const response = await fetch(SEARCH, post("k0"));

    expect(response.status).toBe(429);
    expect(tavily.used).toEqual(["k0", "b1", "b2"]);
  });

  it("没出错、不是发给 Tavily 的请求：原样转发，不读备用 key", async () => {
    const tavily = fakeTavily({ k0: 432 });
    const fetch = withBackupKeys(tavily.fetchImpl, () => {
      throw new Error("should not read the backup keys");
    });

    expect((await fetch(SEARCH, post("k1"))).status).toBe(200);
    expect((await fetch("https://example.com/search", post("k0"))).status).toBe(432);
  });
});

describe("换上的 key 写进 .env（扩展）", () => {
  let dir: string;
  let envFile: string;
  let keysFile: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "omp studio 备用 key-"));
    envFile = path.join(dir, ".env");
    keysFile = path.join(dir, "tavily-keys.json");
    await writeFile(keysFile, JSON.stringify(["b1", "b2", "b3"]), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it("只改 TAVILY_API_KEY 那一行（引号、export、CRLF、BOM、别的变量原样），旧 key 挪到备用列表末尾，留 .env.bak", async () => {
    const before = '\uFEFF# 搜索\r\nexport TAVILY_API_KEY="k0"\r\nOTHER=1\r\n';
    await writeFile(envFile, before, "utf8");

    expect(rotateStoredKey(envFile, keysFile, "k0", "b2")).toBe(true);

    expect(await readFile(envFile, "utf8")).toBe('\uFEFF# 搜索\r\nexport TAVILY_API_KEY="b2"\r\nOTHER=1\r\n');
    expect(await readFile(`${envFile}.bak`, "utf8")).toBe(before);
    expect(JSON.parse(await readFile(keysFile, "utf8"))).toEqual(["b1", "b3", "k0"]);
  });

  it(".env 里已经不是这个用完的 key（别的 omp 进程换过了）、没有这一行、或有两行：都不动", async () => {
    for (const text of ["TAVILY_API_KEY=b1\n", "OTHER=1\n", "TAVILY_API_KEY=k0\nTAVILY_API_KEY=k0\n"]) {
      await writeFile(envFile, text, "utf8");
      expect(rotateStoredKey(envFile, keysFile, "k0", "b2")).toBe(false);
      expect(await readFile(envFile, "utf8")).toBe(text);
    }
    await rm(envFile);
    expect(rotateStoredKey(envFile, keysFile, "k0", "b2")).toBe(false);
    expect(JSON.parse(await readFile(keysFile, "utf8"))).toEqual(["b1", "b2", "b3"]);
  });

  it("包了 fetch 之后：omp 带来的 key 用完、换上的成功，只报告一次换了谁", async () => {
    const switched: string[] = [];
    const tavily = fakeTavily({ k0: 432 });
    const fetch = withBackupKeys(
      tavily.fetchImpl,
      () => ["b1"],
      (dead, next) => switched.push(`${dead}->${next}`),
    );

    await fetch(SEARCH, post("k0"));
    await fetch(SEARCH, post("k0"));

    expect(switched).toEqual(["k0->b1"]);
  });
});

describe("每个 key 的用量（设置页）", () => {
  it("没设 key 上限按账号套餐算；套餐用满且没有按量付费额度才算用尽", () => {
    expect(
      usageFromReply({ key: { usage: 396, limit: null }, account: { plan_usage: 396, plan_limit: 1000 } }),
    ).toEqual({
      state: "ok",
      used: 396,
      limit: 1000,
    });
    expect(usageFromReply({ account: { plan_usage: 1003, plan_limit: 1000 } }).state).toBe("exhausted");
    expect(
      usageFromReply({ account: { plan_usage: 1000, plan_limit: 1000, paygo_usage: 5, paygo_limit: 100 } }).state,
    ).toBe("ok");
  });

  it("key 自己设了上限：按 key 算，哪怕账号套餐还有", () => {
    expect(usageFromReply({ key: { usage: 50, limit: 50 }, account: { plan_usage: 50, plan_limit: 1000 } })).toEqual({
      state: "exhausted",
      used: 50,
      limit: 50,
    });
  });

  it("401 是无效 key；断网、限流查不出来", async () => {
    const reply = (status: number) => (async () => new Response("{}", { status })) as typeof fetch;
    expect((await fetchKeyUsage("k", reply(401))).state).toBe("invalid");
    expect((await fetchKeyUsage("k", reply(429))).state).toBe("unknown");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect((await fetchKeyUsage("k", offline)).state).toBe("unknown");
  });
});
