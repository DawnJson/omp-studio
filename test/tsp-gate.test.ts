import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, nodeRole } from "../src/shared/tsp/document.ts";
import {
  GATE_ACTION_APPROVE,
  GATE_ACTION_DENY,
  GATE_ACTION_DETAILS,
  findGateButton,
  findMessageTarget,
  hasLiveScreen,
  isApprovalDuplicateButton,
  type TspMessageTarget,
} from "../src/shared/tsp/gate.ts";
import { deriveTaskStatus } from "../src/shared/tsp/task-status.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

/** 每份录制逐条消息重放，返回应用该消息之后的每一步（用法同 tsp-task-status.test.ts）。 */
function replay(name: string) {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ message }) => {
    applyMessage(doc, message);
    return {
      target: findMessageTarget(doc),
      ask: deriveTaskStatus(doc).ask,
      approve: findGateButton(doc, GATE_ACTION_APPROVE),
      deny: findGateButton(doc, GATE_ACTION_DENY),
      details: findGateButton(doc, GATE_ACTION_DETAILS),
      screen: hasLiveScreen(doc),
    };
  });
}

const kinds = (steps: { target: TspMessageTarget }[]) => steps.map((step) => step.target.kind);

describe("approval.jsonl：审批期间输入框还在，发消息 = 拒绝并说明理由", () => {
  const steps = replay("approval");
  const waiting = steps.filter((step) => step.ask !== null);

  it("审批卡出现后 composer 的编辑器仍是发送目标，并标明有审批在等", () => {
    expect(waiting.length).toBeGreaterThan(0);
    for (const step of waiting) {
      expect(step.ask).toEqual({ title: "Allow tool: bash", approval: true });
      expect(step.target).toEqual({ kind: "ready", sf: "s:1", id: "j.line/input", approval: true });
    }
  });

  it("审批前后是普通的可发送状态；启动时编辑器还没 sendable 是 pending", () => {
    expect(steps[0]?.target.kind).toBe("pending");
    const first = steps.findIndex((step) => step.ask !== null);
    const last = steps.findLastIndex((step) => step.ask !== null);
    expect(steps[first - 1]?.target).toEqual({ kind: "ready", sf: "s:1", id: "j.line/input", approval: false });
    expect(steps[last + 1]?.target).toEqual({ kind: "ready", sf: "s:1", id: "j.line/input", approval: false });
  });

  it("Details / Deny / Approve 三个按钮按动作名找到，门关掉后找不到", () => {
    for (const step of waiting) {
      expect(step.details).toEqual({ sf: "s:1", id: "t.actions/expand" });
      expect(step.deny).toEqual({ sf: "s:1", id: "t.actions/deny" });
      expect(step.approve).toEqual({ sf: "s:1", id: "t.actions/approve" });
    }
    const last = steps.findLastIndex((step) => step.ask !== null);
    expect(steps.slice(last + 1).every((step) => step.approve === null && step.deny === null)).toBe(true);
    expect(
      steps
        .slice(
          0,
          steps.findIndex((step) => step.ask !== null),
        )
        .every((step) => step.approve === null),
    ).toBe(true);
  });

  it("没有全屏面板", () => {
    expect(steps.every((step) => !step.screen)).toBe(true);
  });

  it("不画的只有底栏的 Deny / Approve：Details、选项、提问对话框和旁路提问的按钮都照画", () => {
    const hidden = (name: string) => {
      const doc = createDocument();
      const ids = new Set<string>();
      const buttons = new Set<string>();
      for (const { message } of tspDocMessages(loadTspFixture(name))) {
        applyMessage(doc, message);
        for (const sf of doc.live)
          for (const node of doc.surfaces.get(sf)!.nodes.values()) {
            if (nodeRole(node) === "omp.btn") buttons.add(node.id);
            if (isApprovalDuplicateButton(node)) ids.add(node.id);
          }
      }
      return { hidden: [...ids].sort(), buttons: buttons.size };
    };
    expect(hidden("approval").hidden).toEqual(["t.actions/approve", "t.actions/deny"]);
    for (const name of ["ask", "ask-multi", "btw"]) {
      const result = hidden(name);
      expect(result.buttons).toBeGreaterThan(0);
      expect(result.hidden).toEqual([]);
    }
  });
});

describe("ask.jsonl：提问把输入框换掉，没有可发的地方", () => {
  const steps = replay("ask");
  const asking = steps.filter((step) => step.ask !== null);

  it("提问期间发送目标是 ask（不是审批），提问卡上没有审批按钮", () => {
    expect(asking.length).toBeGreaterThan(0);
    for (const step of asking) {
      expect(step.ask?.approval).toBe(false);
      expect(step.target).toEqual({ kind: "ask" });
      expect(step.approve).toBeNull();
    }
  });

  it("答完后恢复可发送", () => {
    const last = steps.findLastIndex((step) => step.ask !== null);
    expect(steps[last + 1]?.target.kind).toBe("ready");
  });
});

describe("slash.jsonl：/settings 开出 mode=screen 的 surface 盖住会话", () => {
  const steps = replay("slash");

  it("全屏面板开着的那几帧发送目标是 panel（不往主会话的 composer 发），关掉后恢复", () => {
    const opened = steps.findIndex((step) => step.screen);
    expect(opened).toBeGreaterThan(0);
    const closed = steps.findIndex((step, index) => index > opened && !step.screen);
    expect(closed).toBeGreaterThan(opened);
    expect(kinds(steps.slice(opened, closed))).toEqual(Array<string>(closed - opened).fill("panel"));
    expect(steps[opened - 1]?.target.kind).toBe("ready");
    expect(steps[closed]?.target.kind).toBe("ready");
  });
});

describe("hub-steer.jsonl（omp 18.12.5）：Agent Hub 是 layer 里的 picker，聚焦子代理后 send 就是 steer 它", () => {
  const lines = loadTspFixture("hub-steer");
  const messages = tspDocMessages(lines);
  const doc = createDocument();
  const steps = messages.map(({ t, message }) => {
    applyMessage(doc, message);
    return { t, target: findMessageTarget(doc) };
  });
  const user = recordedUserEvents(lines);
  const at = (predicate: (event: Record<string, unknown>) => boolean) =>
    user.find((entry) => predicate(entry.event))!.t;

  it("Hub 打开期间（agents.open → activate）输入框不是发送目标，打开前和聚焦子代理后都能发", () => {
    const opened = at((event) => event["act"] === "agents.open");
    const activated = at((event) => event["ev"] === "activate" && event["item"] === "Beta");
    const during = steps.filter((step) => step.t > opened + 10 && step.t < activated);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((step) => step.target.kind === "panel")).toBe(true);
    expect(steps.findLast((step) => step.t < opened)?.target.kind).toBe("ready");
    // 聚焦后（omp 把输入框的 send 交给子代理）：目标是同一个编辑器。
    const sent = at((event) => event["ev"] === "send" && event["text"] === "Also say PINEAPPLE in your final reply.");
    expect(steps.findLast((step) => step.t < sent)?.target).toEqual({
      kind: "ready",
      sf: "s:1",
      id: "j.line/input",
      approval: false,
    });
  });
});
