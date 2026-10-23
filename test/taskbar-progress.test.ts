import { describe, expect, it } from "vitest";
import { taskbarProgressMode } from "../src/main/window/taskbar-progress.ts";

describe("任务栏进度", () => {
  it("任一任务在跑 = 不定进度；全部空闲、等你确认、出错、已停止 = 清除", () => {
    expect(taskbarProgressMode([{ status: "idle" }, { status: "running" }])).toBe("indeterminate");
    expect(taskbarProgressMode([{ status: "needs_you" }, { status: "running" }, { status: "stopped" }])).toBe(
      "indeterminate",
    );
    expect(taskbarProgressMode([])).toBe("none");
    expect(
      taskbarProgressMode([{ status: "idle" }, { status: "needs_you" }, { status: "error" }, { status: "stopped" }]),
    ).toBe("none");
  });
});
