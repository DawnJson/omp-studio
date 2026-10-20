import { describe, expect, it } from "vitest";
import { DotSphere, dotCount, type DotFrame } from "../src/renderer/src/features/composer/dot-sphere.ts";

/** 可复现的伪随机数（mulberry32）。 */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (dot: DotFrame) => `${dot.x.toFixed(3)},${dot.y.toFixed(3)},${dot.r.toFixed(3)}`;
const shape = (frame: DotFrame[]) => frame.map(key).sort();

describe("DotSphere", () => {
  it("拧了很多层之后，停顿时点仍落在原来那 26 个位置上（只是互换了）", () => {
    // 每轮：转动开始 -> 转到位(420ms) -> 停顿中(500ms) -> 下一次转动(560ms)。
    const a = new DotSphere(seeded(1));
    const b = new DotSphere(seeded(2));
    let moved = false;
    for (let round = 0; round < 60; round++) {
      const base = round * 560;
      for (const now of [base, base + 420]) {
        a.frame(now);
        b.frame(now);
      }
      const fa = a.frame(base + 500);
      const fb = b.frame(base + 500);
      expect(fa).toHaveLength(dotCount);
      expect(new Set(fa.map(key)).size).toBe(dotCount);
      expect(shape(fa)).toEqual(shape(fb));
      if (fa.map(key).join() !== fb.map(key).join()) moved = true;
    }
    // 两个不同的随机序列确实拧出了不同的排列，而不是什么都没转。
    expect(moved).toBe(true);
  });
});
