import { describe, expect, it } from "vitest";
import type { DialogRequest, TaskId, TaskState } from "../src/shared/ipc.ts";
import { EventEmitter } from "node:events";
import {
  dialogSummary,
  GateNotifier,
  retainNotification,
  type GateNotifierDeps,
} from "../src/main/tasks/gate-notifier.ts";

const select: DialogRequest = { id: "d", kind: "confirm", title: "Allow tool: bash\nCommand: ls", message: "" };

function state(status: TaskState["status"], overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "t1" as TaskId,
    projectId: "p",
    title: "修 bug",
    status,
    dialogs: status === "needs_you" ? [select] : [],
    ...overrides,
  } as TaskState;
}

function setup(overrides: Partial<GateNotifierDeps> = {}) {
  const shown: { title: string; body: string }[] = [];
  const clicked: TaskId[] = [];
  const sounds: number[] = [];
  const notifier = new GateNotifier({
    notifyEnabled: async () => true,
    soundEnabled: async () => true,
    playSound: () => sounds.push(1),
    locale: () => "zh-CN",
    windowFocused: () => false,
    windowHidden: () => true,
    projectName: () => "demo",
    show: (content, onClick) => {
      shown.push(content);
      onClick();
    },
    onClick: (id) => clicked.push(id),
    ...overrides,
  });
  return { notifier, shown, clicked, sounds };
}

describe("等你确认的系统通知", () => {
  it("进入 needs_you 且窗口没有焦点时发一条，标题带项目和任务名，正文是审批首行；点击回到该任务", async () => {
    const { notifier, shown, clicked } = setup();
    await notifier.onState(state("needs_you"));
    expect(shown).toEqual([{ title: "demo · 修 bug", body: "需要你确认：Allow tool: bash" }]);
    expect(clicked).toEqual(["t1"]);
  });

  it("同一次等待不重复通知（第二个门到达、状态重复推送）；离开后再次进入才算新的一次", async () => {
    const { notifier, shown } = setup();
    await notifier.onState(state("needs_you"));
    await notifier.onState(state("needs_you"));
    await notifier.onState(state("running"));
    await notifier.onState(state("needs_you"));
    expect(shown).toHaveLength(2);
  });

  it("窗口有焦点、开关关闭时不发；这次等待也算已处理，不会在失焦后补发", async () => {
    let focused = true;
    const { notifier, shown } = setup({ windowFocused: () => focused });
    await notifier.onState(state("needs_you"));
    focused = false;
    await notifier.onState(state("needs_you"));
    expect(shown).toHaveLength(0);
    const off = setup({ notifyEnabled: async (_task, kind) => kind !== "ask" });
    await off.notifier.onState(state("needs_you"));
    expect(off.shown).toHaveLength(0);
  });

  it("任务没有标题时用占位；英文环境用英文文案", async () => {
    const { notifier, shown } = setup({ locale: () => "en" });
    await notifier.onState(state("needs_you", { title: "" }));
    expect(shown[0]?.title).toMatch(/^demo · \S/);
    expect(shown[0]?.body).not.toMatch(/需要/);
  });

  it("提问取问题的第一行作为正文", () => {
    expect(dialogSummary({ id: "a", kind: "confirm", title: "用哪种语言？\n（单选）", message: "" })).toBe(
      "用哪种语言？",
    );
  });

  it("系统通知对象被持有到点击或关闭为止（没人引用的 Notification 会被回收，点击就不触发了）", () => {
    const held = new Set<EventEmitter>();
    const clicked = new EventEmitter();
    const closed = new EventEmitter();
    retainNotification(held, clicked);
    retainNotification(held, closed);
    expect(held.size).toBe(2);
    clicked.emit("click");
    expect([...held]).toEqual([closed]);
    closed.emit("close");
    expect(held.size).toBe(0);
  });

  it("窗口隐藏在托盘时：任务跑完 / 出错发结果通知；窗口可见、开关关闭、被用户中止时不发", async () => {
    const { notifier, shown, clicked } = setup();
    await notifier.onState(state("running"));
    await notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    expect(shown).toEqual([{ title: "demo · 修 bug", body: "已完成" }]);
    expect(clicked).toEqual(["t1"]);
    await notifier.onState(state("running"));
    await notifier.onState(state("error"));
    expect(shown[1]?.body).toBe("出错了");
    // 等你确认发第三条通知；之后被中止（aborted）不算"跑完"，不再发。
    await notifier.onState(state("needs_you"));
    await notifier.onState(state("idle", { lastTurn: { status: "aborted", endedAt: 2 } }));
    expect(shown).toHaveLength(3);

    const visible = setup({ windowHidden: () => false });
    await visible.notifier.onState(state("running"));
    await visible.notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    expect(visible.shown).toHaveLength(0);
    const off = setup({ notifyEnabled: async (_task, kind) => kind !== "completion" && kind !== "error" });
    await off.notifier.onState(state("running"));
    await off.notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    expect(off.shown).toHaveLength(0);
  });

  it("一轮以错误结束（omp 的 OSC 7501 state=error，任务回到 idle、lastTurn.error 是 omp 的原文）：窗口隐藏时通知里带这段文字的首行", async () => {
    const { notifier, shown } = setup();
    await notifier.onState(state("running"));
    await notifier.onState(
      state("idle", {
        lastTurn: {
          status: "error",
          endedAt: 1,
          error: { message: "Couldn't connect to api.deepseek.com\nsecond line", retryable: false },
        },
      }),
    );
    expect(shown).toEqual([{ title: "demo · 修 bug", body: "出错了: Couldn't connect to api.deepseek.com" }]);
  });

  it("idle 重复推送、没从忙碌状态来的 idle（启动恢复）都不发完成通知", async () => {
    const { notifier, shown } = setup();
    await notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    await notifier.onState(state("running"));
    await notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    await notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    expect(shown).toHaveLength(1);
  });

  it("忙碌一阵又回到 idle、但没产生新的一轮（lastTurn 还是上一轮的出错 / 完成）：不再重复发出错或完成通知", async () => {
    const { notifier, shown, sounds } = setup();
    const failed = { status: "error" as const, endedAt: 1, error: { message: "boom", retryable: false } };
    await notifier.onState(state("running"));
    await notifier.onState(state("idle", { lastTurn: failed }));
    expect(shown).toHaveLength(1);
    await notifier.onState(state("needs_you", { lastTurn: failed }));
    await notifier.onState(state("idle", { lastTurn: failed }));
    const done = { status: "completed" as const, endedAt: 2 };
    await notifier.onState(state("running", { lastTurn: failed }));
    await notifier.onState(state("idle", { lastTurn: done }));
    await notifier.onState(state("running", { lastTurn: done }));
    await notifier.onState(state("idle", { lastTurn: done }));
    expect(shown.map((item) => item.body)).toEqual(["出错了: boom", "需要你确认：Allow tool: bash", "已完成"]);
    expect(sounds).toHaveLength(0);
  });

  it("完成提示音：正常跑完才响（窗口可见也响）；出错、中止、开关关闭不响；发了完成通知（窗口在托盘）不再另响", async () => {
    const completed = state("idle", { lastTurn: { status: "completed", endedAt: 1 } });
    const visible = setup({ windowHidden: () => false });
    await visible.notifier.onState(state("running"));
    await visible.notifier.onState(completed);
    expect(visible.sounds).toHaveLength(1);
    await visible.notifier.onState(state("running"));
    await visible.notifier.onState(state("error"));
    await visible.notifier.onState(state("running"));
    await visible.notifier.onState(state("idle", { lastTurn: { status: "aborted", endedAt: 2 } }));
    expect(visible.sounds).toHaveLength(1);

    const off = setup({ windowHidden: () => false, soundEnabled: async () => false });
    await off.notifier.onState(state("running"));
    await off.notifier.onState(completed);
    expect(off.sounds).toHaveLength(0);

    const tray = setup();
    await tray.notifier.onState(state("running"));
    await tray.notifier.onState(completed);
    expect(tray.shown).toHaveLength(1);
    expect(tray.sounds).toHaveLength(0);
    // 在托盘但通知开关关着：没有通知，就响提示音。
    const quiet = setup({ notifyEnabled: async (_task, kind) => kind !== "completion" });
    await quiet.notifier.onState(state("running"));
    await quiet.notifier.onState(completed);
    expect(quiet.sounds).toHaveLength(1);
  });

  it("三类通知各看 omp 的设置：ask 关了不发“等你处理”，completion 关了不发完成，error 开了才发出错（读的是这个任务）", async () => {
    const asked: string[] = [];
    const only = (on: string) => async (task: TaskState, kind: string) => {
      asked.push(`${task.id}:${kind}`);
      return kind === on;
    };
    const ask = setup({ notifyEnabled: only("ask") });
    await ask.notifier.onState(state("needs_you"));
    await ask.notifier.onState(state("running"));
    await ask.notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    await ask.notifier.onState(state("running"));
    await ask.notifier.onState(state("error"));
    expect(ask.shown.map((item) => item.body)).toEqual(["需要你确认：Allow tool: bash"]);

    const completion = setup({ notifyEnabled: only("completion") });
    await completion.notifier.onState(state("needs_you"));
    await completion.notifier.onState(state("running"));
    await completion.notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    await completion.notifier.onState(state("running"));
    await completion.notifier.onState(state("error"));
    expect(completion.shown.map((item) => item.body)).toEqual(["已完成"]);

    const error = setup({ notifyEnabled: only("error") });
    await error.notifier.onState(state("needs_you"));
    await error.notifier.onState(state("running"));
    await error.notifier.onState(state("idle", { lastTurn: { status: "completed", endedAt: 1 } }));
    await error.notifier.onState(state("running"));
    await error.notifier.onState(state("error"));
    expect(error.shown.map((item) => item.body)).toEqual(["出错了"]);
    expect(asked).toContain("t1:ask");
  });
});
