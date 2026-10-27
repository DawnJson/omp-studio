import { describe, expect, it } from "vitest";
import { elapsedStep, formatElapsed, type ElapsedFormat } from "../src/renderer/src/features/tsp/fmt.ts";

// useAge 按 elapsedStep 向 0 取整后再显示：取整前后 formatElapsed 的文字必须一样，否则计时会显示错或晚一档。
describe("elapsedStep", () => {
  const formats: ElapsedFormat[] = ["short", "seconds", "clock"];
  const samples = [
    0, 1, 99, 100, 999, 1000, 59_949, 59_999, 60_000, 61_234, 3_599_999, 3_600_000, 3_659_999, 7_384_567,
  ];

  for (const format of formats) {
    it(`${format}：取整前后文字一样（正数和倒计时）`, () => {
      for (const ms of samples) {
        const step = elapsedStep(ms, format);
        expect(formatElapsed(Math.trunc(ms / step) * step, format)).toBe(formatElapsed(ms, format));
        // 倒计时：useAge 返回负值，Elapsed 显示 -value。
        expect(formatElapsed(-(Math.trunc(-ms / step) * step), format)).toBe(formatElapsed(ms, format));
      }
    });
  }

  it("整秒显示的格式不按 100ms 走", () => {
    expect(elapsedStep(12_300, "short")).toBe(100);
    expect(elapsedStep(12_300, "seconds")).toBe(1000);
    expect(elapsedStep(12_300, "clock")).toBe(1000);
    expect(elapsedStep(61_000, "short")).toBe(1000);
    expect(elapsedStep(3_600_000, "short")).toBe(60_000);
    expect(elapsedStep(3_600_000, "clock")).toBe(1000);
  });
});
