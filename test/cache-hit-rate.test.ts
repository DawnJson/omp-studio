// 会话信息"用量"里的缓存命中率：cacheRead ÷ (input + cacheRead + cacheWrite)，omp 的 input 不含缓存读写。
import { describe, expect, it } from "vitest";
import { cacheHitRate } from "../src/renderer/src/features/composer/usage-format.ts";

describe("cacheHitRate", () => {
  it("分母是整个提示：输入 + 缓存读取 + 缓存写入", () => {
    expect(cacheHitRate({ input: 400, cacheRead: 600, cacheWrite: 0 })).toBe(0.6);
    expect(cacheHitRate({ input: 100, cacheRead: 700, cacheWrite: 200 })).toBe(0.7);
  });

  it("只写了缓存、还没读到：0，照样显示", () => {
    expect(cacheHitRate({ input: 100, cacheRead: 0, cacheWrite: 900 })).toBe(0);
  });

  it("全部来自缓存：1", () => {
    expect(cacheHitRate({ input: 0, cacheRead: 500, cacheWrite: 0 })).toBe(1);
  });

  it("没有缓存数据（含全是 0）：null，不显示这一行", () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(cacheHitRate({ input: 1234, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});
