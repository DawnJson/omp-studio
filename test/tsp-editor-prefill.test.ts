// omp 往它自己（studio 不画）的输入框里写的文字怎么识别：通用规则 `foreignEditorText`（shared/tsp/editor-prefill.ts），逐帧验证真实录制
// （omp 18.12.6，2026-10-23，`PI_TUI_TSP_RECORD`，临时 agent 目录，deepseek-v4-flash）：
// - history-select：发一句话 → 输入框 Ctrl+R（omp 的历史搜索选择器）→ Enter 选中 → 文字出现在 omp 的输入框；
// - queue-follow-up-esc：运行中 `/queue <文字>`（omp 的 follow-up 队列，条目标题 "After yield"）→ Esc → 排队文字被写回 omp 的输入框；
// - queue-command：只有 studio 的 `send`（含 `/queue`、多行、空 `/queue`）的一整段对话：输入框从头到尾没有文字，不会误判。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { clearEditorEvent, foreignEditorText } from "../src/shared/tsp/editor-prefill.ts";
import { hasQueuedMessages } from "../src/shared/tsp/queue-restore.ts";
import type { TspComposerEditor } from "../src/shared/tsp/session-tree.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

function timeline(name: string) {
  const lines = loadTspFixture(name);
  const doc = createDocument();
  const steps: { text: string | null; queued: boolean }[] = [];
  let firstEditor: TspComposerEditor | null = null;
  for (const { message } of tspDocMessages(lines)) {
    applyMessage(doc, message);
    const editor = foreignEditorText(doc);
    firstEditor ??= editor;
    steps.push({ text: editor?.text ?? null, queued: hasQueuedMessages(doc) });
  }
  return { lines, steps, firstEditor };
}

describe("omp 输入框回填：Ctrl+R 选中历史（history-select）", () => {
  const { lines, steps, firstEditor } = timeline("history-select");

  it("选中之前输入框一直是空的；Enter 选中后出现提示原文，之后被清空", () => {
    const first = steps.findIndex((step) => step.text !== null);
    expect(first).toBeGreaterThan(0);
    expect(steps.slice(0, first).every((step) => step.text === null)).toBe(true);
    expect(steps[first]?.text).toBe("Reply with exactly: HISTORY-ONE");
    expect(steps.at(-1)?.text).toBeNull();
  });

  it("读到的输入框节点就是 studio 要清空的那个，清空事件和录制里发给 omp 的 edit 一致", () => {
    expect(firstEditor).toMatchObject({ sf: "s:1", id: "j.line/input" });
    const recorded = recordedUserEvents(lines).find((entry) => entry.event["ev"] === "edit");
    expect(clearEditorEvent(firstEditor!)).toEqual(recorded?.event);
  });
});

describe("omp 输入框回填：/queue 的排队消息 Esc 后退回（queue-follow-up-esc）", () => {
  const { lines, steps } = timeline("queue-follow-up-esc");

  it("排队区出现过（follow-up 条目），这期间输入框是空的；Esc 那一帧排队区没了、输入框里是排队的原文", () => {
    const queued = steps.filter((step) => step.queued);
    expect(queued.length).toBeGreaterThan(10);
    expect(queued.every((step) => step.text === null)).toBe(true);
    const first = steps.findIndex((step) => step.text !== null);
    expect(steps[first - 1]?.queued).toBe(true);
    expect(steps[first]).toEqual({ text: "queued-b2: reply with exactly OK", queued: false });
  });

  it("studio 发的 `/queue …` 原样在录制里；清空后输入框为空", () => {
    const sent = recordedUserEvents(lines)
      .filter((entry) => entry.event["ev"] === "send")
      .map((entry) => entry.event["text"]);
    expect(sent).toContain("/queue queued-b2: reply with exactly OK");
    expect(steps.at(-1)?.text).toBeNull();
  });
});

describe("omp 输入框回填：studio 自己的 send 不会被当成回填（queue-command）", () => {
  it("send 一整段对话（含 /queue、多行、空 /queue）输入框从没出现过文字", () => {
    const { lines, steps } = timeline("queue-command");
    expect(recordedUserEvents(lines).filter((entry) => entry.event["ev"] === "send")).toHaveLength(3);
    expect(steps.every((step) => step.text === null)).toBe(true);
  });
});
