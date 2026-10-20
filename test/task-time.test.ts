// 侧栏任务行的相对时间：用最后活动时间，运行中不满一分钟不显示尾部。
import { describe, expect, it } from "vitest";
import { createT } from "../src/shared/i18n/index.ts";
import type { TaskState } from "../src/shared/ipc.ts";
import { lastActivityAt, taskTail } from "../src/shared/ui/task-time.ts";

const t = createT("zh-CN");
const now = 10_000_000_000;
const minute = 60_000;

const task = (patch: Partial<TaskState>): TaskState =>
  ({ status: "idle", updatedAt: now - 3 * minute, lastTurn: null, runStartedAt: null, ...patch }) as TaskState;

describe("任务行尾部时间", () => {
  it("时间只看持久化的 updatedAt：lastTurn 本身不改时间（一轮结束时主进程已把 updatedAt 写成结束时间）", () => {
    const finished = task({ updatedAt: now - 5_000, lastTurn: { status: "completed", endedAt: now - 5_000 } });
    expect(lastActivityAt(finished)).toBe(now - 5_000);
    expect(taskTail(t, "zh-CN", finished, now)).toBe("刚刚");
    const stale = task({ lastTurn: { status: "completed", endedAt: now - 5_000 } });
    expect(lastActivityAt(stale)).toBe(now - 3 * minute);
  });

  it("没有跑过：用 updatedAt", () => {
    expect(taskTail(t, "zh-CN", task({}), now)).toBe("3 分钟");
  });

  it("运行中不满一分钟不显示，满了显示分钟数", () => {
    expect(taskTail(t, "zh-CN", task({ status: "running", runStartedAt: now - 2_500 }), now)).toBeNull();
    expect(taskTail(t, "zh-CN", task({ status: "running", runStartedAt: now - 2 * minute - 1 }), now)).toBe("2 分钟");
  });

  it("等待确认不显示，被中止显示已停止", () => {
    expect(taskTail(t, "zh-CN", task({ status: "needs_you" }), now)).toBeNull();
    expect(taskTail(t, "zh-CN", task({ lastTurn: { status: "aborted", endedAt: now } }), now)).toBe(t("task.stopped"));
  });
});
