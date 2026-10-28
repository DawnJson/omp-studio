// Tavily 备用 key 的两层：主进程定时换 omp 存的 key（src/main/tavily/key-credits.ts：`GET /usage` 怎么算用完、换哪一个），
// 扩展在 omp 进程里请求失败时当场换 key 重发（src/main/client-accounts/extension/tavily-keys.mjs）。
// 真 omp 里两层的实测见 docs/architecture/login.md「Tavily 备用 key」。
import { describe, expect, it } from "vitest";
import { withBackupKeys } from "../src/main/client-accounts/extension/tavily-keys.mjs";
import { creditsFromUsage, fetchCredits, pickReplacement, type Credits } from "../src/main/tavily/key-credits.ts";

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

describe("额度算没算用完", () => {
  it("套餐用满：用完；还有按量付费额度：没用完", () => {
    expect(
      creditsFromUsage({ key: { usage: 1000, limit: null }, account: { plan_usage: 1000, plan_limit: 1000 } }),
    ).toBe(false);
    expect(
      creditsFromUsage({ key: { usage: 1003, limit: null }, account: { plan_usage: 1003, plan_limit: 1000 } }),
    ).toBe(false);
    expect(
      creditsFromUsage({
        key: { usage: 1000, limit: null },
        account: { plan_usage: 1000, plan_limit: 1000, paygo_usage: 5, paygo_limit: 100 },
      }),
    ).toBe(true);
    expect(creditsFromUsage({ key: { usage: 396, limit: null }, account: { plan_usage: 396, plan_limit: 1000 } })).toBe(
      true,
    );
  });

  it("key 自己设了上限并用满：用完，哪怕账号套餐还有", () => {
    expect(creditsFromUsage({ key: { usage: 50, limit: 50 }, account: { plan_usage: 50, plan_limit: 1000 } })).toBe(
      false,
    );
  });

  it("无效 key（401）算用完；断网、限流查不出来算不知道", async () => {
    const reply = (status: number) => async () => new Response("{}", { status });
    expect(await fetchCredits("k", reply(401) as typeof fetch)).toBe(false);
    expect(await fetchCredits("k", reply(429) as typeof fetch)).toBeNull();
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await fetchCredits("k", offline)).toBeNull();
  });
});

describe("换哪个 key", () => {
  const credits = (table: Record<string, Credits>) => {
    const asked: string[] = [];
    const lookup = async (key: string) => {
      asked.push(key);
      return table[key] ?? null;
    };
    return { lookup, asked };
  };

  it("当前 key 还有额度：不换，也不去查备用 key", async () => {
    const c = credits({ cur: true, b1: true });
    expect(await pickReplacement("cur", ["b1"], c.lookup)).toBeNull();
    expect(c.asked).toEqual(["cur"]);
  });

  it("当前 key 用完：按顺序跳过用完的、查不出来的和当前这个，换第一个确定有额度的", async () => {
    const c = credits({ cur: false, b1: false, b2: null, b3: true, b4: true });
    expect(await pickReplacement("cur", ["cur", "b1", "b2", "b3", "b4"], c.lookup)).toBe("b3");
    expect(c.asked).toEqual(["cur", "b1", "b2", "b3"]);
  });

  it("当前 key 查不出来（可能只是断网）：不换", async () => {
    expect(await pickReplacement("cur", ["b1"], credits({ cur: null, b1: true }).lookup)).toBeNull();
  });

  it("还没有 key：换上第一个有额度的；备用 key 全用完：不换", async () => {
    expect(await pickReplacement(null, ["b1", "b2"], credits({ b1: false, b2: true }).lookup)).toBe("b2");
    expect(await pickReplacement("cur", ["b1"], credits({ cur: false, b1: false }).lookup)).toBeNull();
  });
});
