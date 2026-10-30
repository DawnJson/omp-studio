import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { deriveTaskStatus, hasRunningWork, type TspTaskStatus } from "../src/shared/tsp/task-status.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

/**
 * 每份录制逐条消息（o、f…，序号从 0 起；omp 18.13 及更早发的 `t` 调色板不算）重放，返回应用该消息之后的状态。
 * 期望值是对着录制里的节点树和用户操作时间核对出来的（见 task-status.ts 的依据）：
 * 序号 = 这一条消息应用之后状态变成它，直到下一个边界。
 */
function replay(name: string) {
  const lines = loadTspFixture(name);
  const messages = tspDocMessages(lines);
  const doc = createDocument();
  const steps = messages.map(({ t, message }) => {
    applyMessage(doc, message);
    return { t, ...deriveTaskStatus(doc), runningWork: hasRunningWork(doc) };
  });
  return { steps, user: recordedUserEvents(lines) };
}

/** [起点序号, 状态] 的分段表 → 每条消息的期望状态。 */
function expectSegments(steps: { status: TspTaskStatus }[], segments: [number, TspTaskStatus][]): void {
  const actual = steps.map((step) => step.status);
  const expected = actual.map((_, index) => segments.findLast(([from]) => from <= index)?.[1]);
  expect(actual).toEqual(expected);
}

describe("deriveTaskStatus：omp 18.12.3 的录制逐帧", () => {
  it("task：发出消息的那一帧起一直在跑（多个并行子代理、工具），最后一帧回到空闲", () => {
    const { steps } = replay("task");
    expect(steps).toHaveLength(144);
    expectSegments(steps, [
      [0, "idle"],
      [8, "running"],
      [142, "idle"],
    ]);
    // 回合结束那一帧，待办面板（omp.hud.activity）还在，但不是"在跑"。
    expect(steps[142]?.working).toBe(false);
    expect(steps.every((step) => step.ask === null)).toBe(true);
  });

  it("ask：提问期间 needs_you（带问题文字），答完回到 running，回答完毕后 idle", () => {
    const { steps, user } = replay("ask");
    expectSegments(steps, [
      [0, "idle"],
      [8, "running"],
      [18, "needs_you"],
      [20, "running"],
      [38, "idle"],
    ]);
    expect(steps[18]?.ask).toEqual({ title: "这个项目你最看重哪个方向?", approval: false });
    // 提问时 composer 被换掉，但运行状态行还在：任务没有结束。
    expect(steps[18]?.working).toBe(true);
    // 以用户回答的时间为准：回答之前最后一帧在等，之后第一帧不再等。
    const answeredAt = user.find((entry) => entry.event["ev"] === "activate")!.t;
    const before = steps.findLast((step) => step.t < answeredAt)!;
    const after = steps.find((step) => step.t > answeredAt)!;
    expect(before.status).toBe("needs_you");
    expect(after.status).toBe("running");
  });

  it("approval：审批门出现到点了 Approve 之间 needs_you，之后继续跑，结束 idle", () => {
    const { steps, user } = replay("approval");
    expectSegments(steps, [
      [0, "idle"],
      [8, "running"],
      [16, "needs_you"],
      [18, "running"],
      [21, "idle"],
    ]);
    expect(steps[16]?.ask).toEqual({ title: "Allow tool: bash", approval: true });
    const approvedAt = user.find((entry) => entry.event["act"] === "approve")!.t;
    expect(steps.findLast((step) => step.t < approvedAt)?.status).toBe("needs_you");
    expect(steps.find((step) => step.t > approvedAt)?.status).toBe("running");
  });

  it("picker、slash：选择器、斜杠菜单、设置面板（另一个 screen surface）都不是在跑也不是在等", () => {
    for (const name of ["picker", "slash"])
      expect(new Set(replay(name).steps.map((step) => step.status))).toEqual(new Set(["idle"]));
  });

  it("没有 dock 的文档（刚握手、surface 还没画）是 idle", () => {
    expect(deriveTaskStatus(createDocument())).toEqual({
      status: "idle",
      working: false,
      ask: null,
      loader: null,
      modal: null,
    });
  });
});

describe("hasRunningWork", () => {
  it("回合进行中有 pending 的工具/子代理卡片；回合结束后都是 done", () => {
    const { steps } = replay("task");
    expect(steps.slice(8, 142).some((step) => step.runningWork)).toBe(true);
    expect(steps[142]?.runningWork).toBe(false);
    expect(steps[143]?.runningWork).toBe(false);
  });
});
