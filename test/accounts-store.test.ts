import { describe, expect, it } from "vitest";
import { createCachedLoader, type CachedLoad } from "../src/shared/ui/cached-loader.ts";

function harness() {
  let state: CachedLoad<string> = { kind: "idle" };
  const gates: PromiseWithResolvers<string>[] = [];
  const loader = createCachedLoader<string>(
    () => {
      const gate = Promise.withResolvers<string>();
      gates.push(gate);
      return gate.promise;
    },
    () => state,
    (next) => {
      state = next;
    },
  );
  return { loader, gates, state: () => state };
}

describe("cached loader", () => {
  it("退出登录后的 force 重读不并进旧读取；旧读取晚到的结果被丢弃", async () => {
    const h = harness();
    const first = h.loader.load();
    const second = h.loader.load(true);
    expect(h.gates).toHaveLength(2);
    h.gates[1]?.resolve("signed-out");
    await second;
    h.gates[0]?.resolve("signed-in-stale");
    await first;
    expect(h.state()).toMatchObject({ kind: "ready", data: "signed-out" });
  });

  it("普通进入合并进进行中的读取；有缓存时刷新失败保留内容并记下错误", async () => {
    const h = harness();
    const a = h.loader.load();
    const b = h.loader.load();
    expect(h.gates).toHaveLength(1);
    h.gates[0]?.resolve("cached");
    await Promise.all([a, b]);
    const again = h.loader.load();
    expect(h.state()).toMatchObject({ kind: "ready", refreshing: true });
    h.gates[1]?.reject(new Error("offline"));
    await again;
    expect(h.state()).toMatchObject({
      kind: "ready",
      data: "cached",
      refreshing: false,
      refreshError: expect.any(Error),
    });
  });

  it("没有缓存时失败整体报错", async () => {
    const h = harness();
    const run = h.loader.load();
    h.gates[0]?.reject(new Error("x"));
    await run;
    expect(h.state()).toMatchObject({ kind: "error" });
  });
});
