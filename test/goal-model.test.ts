// 目标模式的纯函数：/goal 参数、按钮、用量文字。
import { describe, expect, it } from "vitest";
import type { TaskGoal } from "../src/shared/ipc.ts";
import { formatTokens, goalButtons, goalUsage, parseGoalArgs } from "../src/renderer/src/features/goal/goal-model.ts";

const goal = (extra: Partial<TaskGoal> = {}): TaskGoal => ({
  id: "g",
  objective: "o",
  status: "active",
  tokensUsed: 0,
  tokenBudget: null,
  timeUsedSeconds: 0,
  ...extra,
});

describe("parseGoalArgs", () => {
  it("空 = 显示当前目标；单独的 pause / resume / drop（不分大小写）是操作；其余整段是目标", () => {
    expect(parseGoalArgs("")).toEqual({ kind: "show" });
    expect(parseGoalArgs("   ")).toEqual({ kind: "show" });
    expect(parseGoalArgs("Pause")).toEqual({ kind: "op", op: "pause" });
    expect(parseGoalArgs("resume")).toEqual({ kind: "op", op: "resume" });
    expect(parseGoalArgs("DROP")).toEqual({ kind: "op", op: "drop" });
    expect(parseGoalArgs("pause the deploy")).toEqual({ kind: "create", objective: "pause the deploy" });
    expect(parseGoalArgs("把测试跑绿")).toEqual({ kind: "create", objective: "把测试跑绿" });
  });
});

describe("goalButtons", () => {
  it("没有目标没有按钮；进行中可暂停；暂停可继续；预算用尽只能放弃", () => {
    expect(goalButtons(null)).toEqual([]);
    expect(goalButtons(goal())).toEqual(["pause", "drop"]);
    expect(goalButtons(goal({ status: "paused" }))).toEqual(["resume", "drop"]);
    expect(goalButtons(goal({ status: "budget-limited" }))).toEqual(["drop"]);
  });
});

describe("formatTokens / goalUsage", () => {
  it("紧凑的 token 数", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(9_323)).toBe("9.3k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("有预算时显示 已用 / 预算", () => {
    expect(goalUsage({ tokensUsed: 9_323, tokenBudget: 20_000 })).toBe("9.3k / 20k");
    expect(goalUsage({ tokensUsed: 800, tokenBudget: null })).toBe("800");
  });
});
