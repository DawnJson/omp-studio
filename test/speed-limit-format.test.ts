import { describe, expect, it } from "vitest";
import {
  formatTokensPerSecond,
  slowScopeKey,
  speedBadges,
} from "../src/renderer/src/features/composer/speed-limit-format.ts";

const off = { enabled: false, active: false };
const noSlow = { supported: false, enabled: false, scope: null } as const;

describe("speedBadges", () => {
  it("fast 看 active，不看开关；slow 要支持且开着", () => {
    expect(speedBadges(off, noSlow)).toEqual([]);
    expect(speedBadges({ enabled: true, active: false }, noSlow)).toEqual([]);
    expect(speedBadges({ enabled: true, active: true }, noSlow)).toEqual(["fast"]);
    expect(speedBadges(off, { supported: true, enabled: true, scope: "global" })).toEqual(["slow"]);
    expect(speedBadges(off, { supported: false, enabled: true, scope: null })).toEqual([]);
    expect(speedBadges({ enabled: true, active: true }, { supported: true, enabled: true, scope: "session" })).toEqual([
      "fast",
      "slow",
    ]);
  });

  it("只有全局范围有说明文案", () => {
    expect(slowScopeKey.global).toBe("model.slow.scope.global");
    expect(slowScopeKey.session).toBeNull();
  });
});

describe("formatTokensPerSecond", () => {
  it("≥100 取整，否则一位小数，没有值时返回 null", () => {
    expect(formatTokensPerSecond(176.06868)).toBe("176");
    expect(formatTokensPerSecond(99.96)).toBe("100");
    expect(formatTokensPerSecond(42)).toBe("42.0");
    expect(formatTokensPerSecond(null)).toBeNull();
    expect(formatTokensPerSecond(0)).toBeNull();
    expect(formatTokensPerSecond(-3)).toBeNull();
    expect(formatTokensPerSecond(Number.NaN)).toBeNull();
    expect(formatTokensPerSecond(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
