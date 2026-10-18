import { describe, expect, it } from "vitest";
import type { DialogRequest, TaskId, TaskState } from "../src/shared/ipc.ts";
import { EventEmitter } from "node:events";
import {
  dialogSummary,
  GateNotifier,
  retainNotification,
  type GateNotifierDeps,
} from "../src/main/tasks/gate-notifier.ts";

const select: DialogRequest = {
  id: "d",
  kind: "select",
  title: "Allow tool: bash\nCommand: ls",
  options: [{ label: "Approve" }],
  approval: true,
};

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
  const notifier = new GateNotifier({
    enabled: async () => true,
    locale: () => "zh-CN",
    windowFocused: () => false,
    projectName: () => "demo",
    show: (content, onClick) => {
      shown.push(content);
      onClick();
    },
    onClick: (id) => clicked.push(id),
    ...overrides,
  });
  return { notifier, shown, clicked };
}

describe("等你确认的系统通知", () => {
  it("进入 needs_you 且窗口没有焦点时发一条，标题带项目和任务名，正文是审批首行；点击回到该任务", async () => {
    const { notifier, shown, clicked } = setup();
    await notifier.onState(state("needs_you"));
    expect(shown).toEqual([{ title: "demo · 修 bug", body: "需要你确认：Allow tool: bash" }]);
    expect(clicked).toEqual(["t1"]);
  });

  it("同一次等待不重复通知（第二个对话框到达、状态重复推送）；离开后再次进入才算新的一次", async () => {
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
    const off = setup({ enabled: async () => false });
    await off.notifier.onState(state("needs_you"));
    expect(off.shown).toHaveLength(0);
  });

  it("任务没有标题时用占位；英文环境用英文文案", async () => {
    const { notifier, shown } = setup({ locale: () => "en" });
    await notifier.onState(state("needs_you", { title: "" }));
    expect(shown[0]?.title).toMatch(/^demo · \S/);
    expect(shown[0]?.body).not.toMatch(/需要/);
  });

  it("ask 取第一题作为正文", () => {
    expect(
      dialogSummary({ id: "a", kind: "ask", questions: [{ id: "q", question: "用哪种语言？", options: [] }] }),
    ).toBe("用哪种语言？");
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
});
