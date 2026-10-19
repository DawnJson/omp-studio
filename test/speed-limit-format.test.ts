import { describe, expect, it } from "vitest";
import {
  formatResetTime,
  formatTokensPerSecond,
  slowScopeKey,
  speedBadges,
  usageLimitBanner,
} from "../src/renderer/src/features/composer/speed-limit-format.ts";
import { NO_SESSION_EXTRAS, sessionExtras } from "../src/main/tasks/session-extras.ts";
import type { SessionState } from "../src/shared/omp-wire/rpc-wire.generated.ts";

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

  it("两种范围都有说明文案", () => {
    expect(slowScopeKey.global).toBe("model.slow.scope.global");
    expect(slowScopeKey.session).toBe("model.slow.scope.session");
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

describe("formatResetTime", () => {
  const local = (month: number, day: number, hour: number, minute: number) =>
    new Date(2026, month - 1, day, hour, minute).getTime();

  it("今天只写时间，别的日子带日期（本机时区）", () => {
    const now = local(10, 19, 9, 0);
    expect(formatResetTime(local(10, 19, 14, 5) / 1000, now)).toBe("14:05");
    expect(formatResetTime(local(10, 20, 0, 30) / 1000, now)).toBe("10-20 00:30");
    expect(formatResetTime(local(11, 2, 23, 59) / 1000, now)).toBe("11-2 23:59");
  });
});

describe("usageLimitBanner", () => {
  const now = new Date(2026, 9, 19, 9, 0).getTime();
  const at = new Date(2026, 9, 19, 14, 5).getTime() / 1000;

  it("没超限时没有横幅", () => {
    expect(usageLimitBanner(null, now)).toBeNull();
  });

  it("low_priority：主句 + 重置时间 + 剩余额度（限制在 0–100）", () => {
    expect(usageLimitBanner({ stage: "low_priority", resetsAtSec: at, allowanceLeftPercent: 39.6 }, now)).toEqual({
      stage: "low_priority",
      message: "composer.limit.lowPriority",
      details: [
        { key: "composer.limit.resets", params: { time: "14:05" } },
        { key: "composer.limit.left", params: { p: 40 } },
      ],
    });
    expect(
      usageLimitBanner({ stage: "low_priority", resetsAtSec: at, allowanceLeftPercent: 140 }, now)?.details[1]?.params,
    ).toEqual({ p: 100 });
    expect(usageLimitBanner({ stage: "low_priority", resetsAtSec: at }, now)?.details).toHaveLength(1);
  });

  it("wrap_up：按 extraUsage 选句；resetsAtSec 缺省时不写重置时间", () => {
    expect(usageLimitBanner({ stage: "wrap_up", extraUsage: false }, now)).toEqual({
      stage: "wrap_up",
      message: "composer.limit.wrapUp",
      details: [],
    });
    expect(usageLimitBanner({ stage: "wrap_up", extraUsage: true, resetsAtSec: at }, now)).toEqual({
      stage: "wrap_up",
      message: "composer.limit.wrapUpExtra",
      details: [{ key: "composer.limit.resets", params: { time: "14:05" } }],
    });
  });
});

describe("sessionExtras（get_state → TaskState 的字段）", () => {
  const base: SessionState = { sessionId: "s" } as SessionState;

  it("字段全缺省 = 默认值", () => {
    expect(sessionExtras(base)).toEqual(NO_SESSION_EXTRAS);
  });

  it("原样搬运 fast / slow / usageLimit / tokensPerSecond", () => {
    const usageLimit = { stage: "wrap_up", extraUsage: true, resetsAtSec: 1 } as const;
    expect(
      sessionExtras({
        ...base,
        fastModeEnabled: true,
        fastModeActive: false,
        slowModeSupported: true,
        slowModeEnabled: true,
        slowModeScope: "session",
        usageLimit,
        tokensPerSecond: 12.5,
      }),
    ).toEqual({
      fastMode: { enabled: true, active: false },
      slowMode: { supported: true, enabled: true, scope: "session" },
      usageLimit,
      tokensPerSecond: 12.5,
    });
  });

  it("不支持 slow 时 enabled / scope 一律收口，tokensPerSecond 非有限数当没有", () => {
    expect(
      sessionExtras({
        ...base,
        slowModeSupported: false,
        slowModeEnabled: true,
        slowModeScope: "global",
        tokensPerSecond: Number.NaN,
      }),
    ).toMatchObject({ slowMode: { supported: false, enabled: false, scope: null }, tokensPerSecond: null });
    expect(sessionExtras({ ...base, tokensPerSecond: null }).tokensPerSecond).toBeNull();
  });
});
