import { describe, expect, it } from "vitest";
import type { DialogRequest, TaskError } from "../src/shared/ipc.ts";
import {
  initialMachineState,
  transition,
  type MachineInput,
  type MachineState,
} from "../src/main/tasks/task-machine.ts";

const select: DialogRequest = { id: "d1", kind: "select", title: "t", options: [{ label: "a" }], approval: false };
const confirm: DialogRequest = { id: "d2", kind: "confirm", title: "t", message: "m" };
const exited: TaskError = { kind: "exited", message: "omp exited with code 1" };

function run(inputs: MachineInput[], from: MachineState = initialMachineState("stopped")): MachineState {
  return inputs.reduce(transition, from);
}
const idle = run([{ type: "start" }, { type: "ready" }]);
const running = run([{ type: "agent_start" }], idle);
const settledResult: MachineInput = {
  type: "prompt_result",
  status: "completed",
  sessionSettled: true,
  at: 5,
  foreground: true,
};

describe("task 状态机：转换表（用户看到的任务状态）", () => {
  it("stopped → starting → idle：只有握手和初始化完成后才可用", () => {
    expect(run([{ type: "start" }]).status).toBe("starting");
    expect(idle.status).toBe("idle");
  });

  it("启动失败进入 error 并带上错误；restart 可以再启动并清掉旧错误", () => {
    const failed = run([
      { type: "start" },
      { type: "start_failed", error: { kind: "handshake_failed", message: "x" } },
    ]);
    expect(failed.status).toBe("error");
    expect(failed.error?.kind).toBe("handshake_failed");
    const again = transition(failed, { type: "start" });
    expect(again.status).toBe("starting");
    expect(again.error).toBeNull();
  });

  it("prompt 被接受进入 running；agentInvoked=false（本地斜杠命令）不进 running", () => {
    expect(run([{ type: "prompt_accepted", agentInvoked: true }], idle).status).toBe("running");
    expect(run([{ type: "prompt_accepted", agentInvoked: false }], idle).status).toBe("idle");
  });

  it("后台任务唤醒 agent（没有 prompt）时 agent_start 也进 running", () => {
    expect(running.status).toBe("running");
  });

  it("prompt 应答失败：留在原状态，记 lastTurn=error（侧栏错误色），markRead 之后清除", () => {
    const rejected = run([{ type: "prompt_rejected", message: "boom", at: 7 }], idle);
    expect(rejected.status).toBe("idle");
    expect(rejected.lastTurn).toMatchObject({ status: "error", endedAt: 7 });
    expect(transition(rejected, { type: "mark_read" }).lastTurn).toBeNull();
  });

  it("prompt_result(sessionSettled=true) 直接 idle 并写 lastTurn；前台任务不置 unread", () => {
    const done = transition(running, settledResult);
    expect(done.status).toBe("idle");
    expect(done.lastTurn).toEqual({ status: "completed", endedAt: 5 });
    expect(done.unread).toBe(false);
  });

  it("任务不在前台时 prompt_result 置 unread；markRead 清除，已完成的 lastTurn 保留", () => {
    const done = transition(running, { ...settledResult, foreground: false } as MachineInput);
    expect(done.unread).toBe(true);
    const read = transition(done, { type: "mark_read" });
    expect(read.unread).toBe(false);
    expect(read.lastTurn?.status).toBe("completed");
  });

  it("prompt_result(sessionSettled=false) 仍是 running，直到 session_settled（后台任务还能唤醒 agent）", () => {
    const pending = transition(running, { ...settledResult, sessionSettled: false } as MachineInput);
    expect(pending.status).toBe("running");
    expect(transition(pending, { type: "session_settled" }).status).toBe("idle");
  });

  it("prompt 失败的结局（error）：任务回到 idle，lastTurn 带错误详情", () => {
    const failedTurn = transition(running, {
      type: "prompt_result",
      status: "error",
      error: { message: "401", retryable: false },
      sessionSettled: true,
      at: 9,
      foreground: true,
    });
    expect(failedTurn.status).toBe("idle");
    expect(failedTurn.lastTurn?.error?.message).toBe("401");
  });

  it("有未答对话框一定是 needs_you，全部答完且仍在跑回 running，已 settled 回 idle", () => {
    const one = transition(running, { type: "dialog_open", request: select });
    const two = transition(one, { type: "dialog_open", request: confirm });
    expect(two.status).toBe("needs_you");
    const afterFirst = transition(two, { type: "dialog_close", id: "d1" });
    expect(afterFirst.status).toBe("needs_you");
    expect(transition(afterFirst, { type: "dialog_close", id: "d2" }).status).toBe("running");
    // 审批答完之前这一轮已经 settled（例如被 cancel 后中止）：回 idle。
    const settledWhileWaiting = transition(two, settledResult);
    expect(settledWhileWaiting.status).toBe("needs_you");
    const answered = transition(transition(settledWhileWaiting, { type: "dialog_close", id: "d1" }), {
      type: "dialog_close",
      id: "d2",
    });
    expect(answered.status).toBe("idle");
  });

  it("idle 时来的对话框（极少见）也是 needs_you；omp 发 cancel 后对话框消失", () => {
    const waiting = transition(idle, { type: "dialog_open", request: select });
    expect(waiting.status).toBe("needs_you");
    expect(transition(waiting, { type: "dialog_close", id: "d1" }).status).toBe("idle");
  });

  it("对不上的 dialog_close（已被 cancel 的对话框收到迟到的应答）不改变状态", () => {
    expect(transition(running, { type: "dialog_close", id: "ghost" })).toBe(running);
  });

  it("同一 id 的对话框重复到达只保留一份", () => {
    const twice = run(
      [
        { type: "dialog_open", request: select },
        { type: "dialog_open", request: select },
      ],
      running,
    );
    expect(twice.dialogs).toHaveLength(1);
  });

  it("进程意外退出：任何存活状态都进 error，清空对话框，保留 kind", () => {
    const waiting = transition(running, { type: "dialog_open", request: select });
    const failed = transition(waiting, { type: "failed", error: exited });
    expect(failed).toMatchObject({ status: "error", dialogs: [], working: false, error: exited });
  });

  it("主动关闭（回收、归档、关应用）是 stopped，不是 error", () => {
    expect(transition(running, { type: "stopped" })).toMatchObject({ status: "stopped", working: false });
  });

  it("没有进程的状态不接收会话事件：stopped 收到 agent_start 或对话框保持 stopped", () => {
    const stopped = initialMachineState("stopped");
    expect(transition(stopped, { type: "agent_start" })).toBe(stopped);
    expect(transition(stopped, { type: "dialog_open", request: select })).toBe(stopped);
  });
});
