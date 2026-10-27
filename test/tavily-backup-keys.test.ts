// Tavily 备用 key 的判断（src/main/tavily/key-credits.ts）：`GET /usage` 的回复怎么算用完，当前 key 用完时换哪一个。
import { describe, expect, it } from "vitest";
import { creditsFromUsage, fetchCredits, pickReplacement, type Credits } from "../src/main/tavily/key-credits.ts";

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
