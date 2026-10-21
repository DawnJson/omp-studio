// 额度重置时间（shared/ui/reset-time.ts）：星期和时间之间有空格，zh-CN 的 Intl 原本会连在一起（"周三13:07"）。
import { describe, expect, it } from "vitest";
import { formatQuotaReset } from "../src/shared/ui/reset-time.ts";

// 2026-10-21 是周三；按本机时区构造，和格式化用同一个时区。
const now = new Date(2026, 9, 21, 9, 0).getTime();
const wed = new Date(2026, 9, 21, 13, 7).getTime();

describe("formatQuotaReset", () => {
  it("zh-CN 星期和时间之间有空格", () => {
    expect(formatQuotaReset("zh-CN", wed, now)).toBe("周三 13:07");
  });
  it("en 保持 Wed 13:07", () => {
    expect(formatQuotaReset("en", wed, now)).toBe("Wed 13:07");
  });
  it("超过 7 天写短日期，不带时间", () => {
    const later = new Date(2026, 10, 5, 13, 7).getTime();
    expect(formatQuotaReset("en", later, now)).not.toContain("13:07");
  });
});
