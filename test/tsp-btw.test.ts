// 旁路提问（/btw）读 TSP 文档的纯函数（src/shared/tsp/btw.ts）：用 omp 18.12.5 的真实录制逐帧验证——
//   fixtures/tsp/btw.jsonl       主轮在流式输出时提问 pong → 再问 ping → 裸 /btw 选回第一个话题追问 → 取消一个长回答
//   fixtures/tsp/btw-error.jsonl 无效 API key：提问失败（Failed + omp.btw.error）、对失败的话题追问
// 以及磁盘上的 btw-history/entry-*.json（同一次录制的原文）。
import { describe, expect, it } from "vitest";
import type { BtwHistoryRecord } from "../src/shared/btw.ts";
import { applyBtwEvent } from "../src/shared/btw.ts";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { findMessageTarget, hasBlockingPanel } from "../src/shared/tsp/gate.ts";
import {
  btwButtonEvent,
  btwEventsFor,
  btwFillEvent,
  btwSelectEvent,
  btwStatusFromMeta,
  btwViewRunning,
  findBtwView,
  isBtwOverlayNode,
  isProvisionalBtwId,
  mergeBtwDisk,
  normalizeBtwQuestion,
  parseBtwEntry,
  resolveViewRecordId,
  viewToRecord,
  type BtwView,
} from "../src/shared/tsp/btw.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

interface Step {
  /** 这一帧之前录制里用户的操作数（含第一句话）。 */
  userEvents: number;
  view: BtwView | null;
  /** 这一帧时文档的几项读数（文档是原地更新的，之后再读就变了）。 */
  overlayParent: string | null;
  userMessages: string[];
  target: ReturnType<typeof findMessageTarget>;
  blocking: boolean;
}

/** 逐帧放录制，每帧之后读一次弹窗。 */
function replay(name: string): { steps: Step[]; events: Record<string, unknown>[] } {
  const lines = loadTspFixture(name);
  const events = recordedUserEvents(lines);
  const doc = createDocument();
  const steps: Step[] = [];
  let seenEvents = 0;
  for (const line of lines) {
    if (line.dir === "in" && typeof line.body === "object" && line.body !== null) {
      if ((line.body as Record<string, unknown>)["ev"] !== "ack") seenEvents += 1;
      continue;
    }
    const message = tspDocMessages([line])[0]?.message;
    if (!message) continue;
    applyMessage(doc, message);
    const surface = doc.surfaces.get("s:1");
    const nodes = surface ? [...surface.nodes.values()] : [];
    steps.push({
      userEvents: seenEvents,
      view: findBtwView(doc),
      overlayParent: nodes.find((node) => node.k === "overlay" && isBtwOverlayNode(node))?.parent ?? null,
      userMessages: nodes.filter((node) => node.p["role"] === "omp.user").map((node) => JSON.stringify(node.p)),
      target: findMessageTarget(doc),
      blocking: hasBlockingPanel(doc),
    });
  }
  return { steps, events: events.map((entry) => entry.event) };
}

const pong = replay("btw");
const failed = replay("btw-error");

/** 弹窗存在的帧里，第一问是 `question` 的最后一次读到的视图。 */
function lastViewOf(steps: readonly Step[], question: string): BtwView {
  const view = steps.findLast((step) => step.view?.turns[0]?.question === question)?.view;
  if (!view) throw new Error(`no view for ${question}`);
  return view;
}

describe("弹窗节点（btw.jsonl，omp 18.12.5）", () => {
  it("只有 overlay role=omp.overlay.btwHistory 被认作旁路提问弹窗；别的弹窗不算", () => {
    expect(isBtwOverlayNode({ p: { role: "omp.overlay.btwHistory" } })).toBe(true);
    expect(isBtwOverlayNode({ p: { role: "omp.overlay.jobs" } })).toBe(false);
    expect(isBtwOverlayNode({ p: {} })).toBe(false);
  });

  it("提问时 main 里什么也不加（没有 omp.user / 排队），弹窗只在 layer 里；输入框照常是发送目标", () => {
    const open = pong.steps.filter((step) => step.view !== null);
    expect(open.length).toBeGreaterThan(0);
    for (const step of open) {
      expect(step.overlayParent).toBe("layer");
      // "/btw" 这句话没有被 omp 当成用户消息回显到 main 里。
      for (const message of step.userMessages) expect(message).not.toContain("/btw");
      expect(step.blocking).toBe(false);
      expect(step.target).toMatchObject({ kind: "ready", sf: "s:1", id: "j.line/input" });
    }
  });

  it("回答中：第一问 = 问题、状态 running、有 stop 和 close 按钮、没有话题列表；收尾后 stop 换成 follow-up", () => {
    const running = pong.steps.filter(
      (step) => step.view?.turns[0]?.question === "Reply with exactly the word: pong" && btwViewRunning(step.view),
    );
    expect(running.length).toBeGreaterThan(0);
    const first = running[0]!.view!;
    expect(first.list).toBeNull();
    expect(first.turns).toEqual([
      {
        kind: "question",
        question: "Reply with exactly the word: pong",
        status: "running",
        answer: "",
        error: undefined,
      },
    ]);
    expect(Object.keys(first.buttons).sort()).toEqual(["close", "stop"]);
    const done = lastViewOf(pong.steps, "Reply with exactly the word: pong");
    expect(done.turns[0]).toMatchObject({ status: "complete", answer: "pong" });
    expect(Object.keys(done.buttons).sort()).toEqual(["close", "follow-up"]);
  });

  it("答案是流式追加的：每帧的答案都是后一帧答案的前缀", () => {
    const essay = pong.steps
      .map((step) => step.view)
      .filter((view): view is BtwView => view?.turns[0]?.question === "Write a 400 word essay about trees.");
    expect(essay.length).toBeGreaterThan(10);
    const answers = essay.map((view) => view.turns[0]!.answer);
    for (let i = 1; i < answers.length; i += 1) expect(answers[i]!.startsWith(answers[i - 1]!)).toBe(true);
    expect(answers.at(-1)!.length).toBeGreaterThan(answers[0]!.length);
  });

  it("取消（stop）→ 状态 Cancelled，保留已收到的部分答案；之后不再回答中", () => {
    const cancelled = lastViewOf(pong.steps, "Write a 400 word essay about trees.");
    expect(cancelled.turns[0]).toMatchObject({ status: "cancelled" });
    expect(cancelled.turns[0]!.answer.startsWith("# Trees")).toBe(true);
    expect(btwViewRunning(cancelled)).toBe(false);
  });

  it("两个话题起：左边有 list，item id 的最后一段是话题 id，selected 是新的那个；右边只有选中话题的问答", () => {
    const withList = pong.steps.find(
      (step) => step.view?.list && step.view.turns[0]?.question === "Reply with exactly the word: ping",
    )!.view!;
    expect(withList.list!.items.map((item) => item.question)).toEqual([
      "Reply with exactly the word: ping",
      "Reply with exactly the word: pong",
    ]);
    expect(withList.list!.selected).toBe(withList.list!.items[0]!.recordId);
    expect(withList.list!.items[0]!.running).toBe(true);
    expect(withList.list!.items[1]!.running).toBe(false);
    expect(withList.turns).toHaveLength(1);
  });
});

describe("驱动弹窗的事件和录制逐字相同", () => {
  const select = pong.events.find((event) => event["ev"] === "select")!;
  const edit = pong.events.find((event) => event["ev"] === "edit")!;
  const actions = pong.events.filter((event) => event["ev"] === "action");

  it("select：裸 /btw 打开历史后选第二个话题，item 是 item 节点的完整 id", () => {
    const history = pong.steps.findLast(
      (step) => step.userEvents === pong.events.indexOf(select) && step.view?.list,
    )!.view!;
    expect(history.list!.items).toHaveLength(2);
    const target = history.list!.items[1]!;
    expect(btwSelectEvent(history, target.recordId)).toEqual(select);
    expect(btwSelectEvent(history, "nope")).toBeNull();
    // 选中之前 selected 是新的那个（ping）。
    expect(history.turns[0]!.question).toBe("Reply with exactly the word: ping");
  });

  it("选中后右边换成被选话题（pong）的问答，并有 follow-up 按钮", () => {
    const selected = pong.steps.find(
      (step) => step.userEvents > pong.events.indexOf(select) && step.view?.turns[0]?.question.endsWith("pong"),
    )!.view!;
    expect(selected.list!.selected).toBe(selected.list!.items.find((item) => item.question.endsWith("pong"))!.recordId);
    expect(selected.turns[0]).toMatchObject({ status: "complete", answer: "pong" });
    expect(selected.buttons["follow-up"]).toBeDefined();
  });

  it("追问：点 follow-up → 出现输入框（空）→ edit 填字 → 点 send → 新的一问 running → 收尾", () => {
    const followIndex = pong.events.findIndex((event) => event["act"] === "follow-up");
    const composing = pong.steps.find((step) => step.userEvents === followIndex + 1 && step.view?.composer)!.view!;
    expect(composing.composer).toMatchObject({ text: "" });
    expect(btwFillEvent(composing, "Say gamma")).toEqual(edit);
    expect(btwButtonEvent(composing, "send")).toEqual(actions.find((event) => event["act"] === "send"));
    const asked = pong.steps.find(
      (step) => step.view?.turns.length === 2 && step.view.turns[1]!.question === "Say gamma",
    )!.view!;
    expect(asked.turns[1]).toMatchObject({ kind: "followUp", status: "running" });
    const done = lastViewOf(pong.steps, "Reply with exactly the word: pong");
    expect(done.turns[1]).toMatchObject({
      kind: "followUp",
      question: "Say gamma",
      status: "complete",
      answer: "gamma",
    });
  });

  it("close / stop / follow-up 的 action 事件和录制相同", () => {
    expect(actions.map((event) => event["act"])).toEqual([
      "close",
      "close",
      "follow-up",
      "send",
      "close",
      "stop",
      "close",
    ]);
    const stopAt = pong.events.findIndex((event) => event["act"] === "stop");
    const stopStep = pong.steps.findLast((step) => step.userEvents === stopAt)!;
    expect(btwButtonEvent(stopStep.view!, "stop")).toEqual(actions.find((event) => event["act"] === "stop"));
  });
});

describe("状态词和失败（btw-error.jsonl，无效 API key）", () => {
  it("meta 状态词：Answering / Cancelled / Failed / Interrupted；只有时间 = complete", () => {
    expect(btwStatusFromMeta("Oct 21, 2026, 18:27  ·  ● Answering")).toBe("running");
    expect(btwStatusFromMeta("Oct 21, 2026, 18:22  ·  Cancelled")).toBe("cancelled");
    expect(btwStatusFromMeta("Oct 21, 2026, 18:27  ·  Failed")).toBe("error");
    expect(btwStatusFromMeta("Oct 21, 2026, 18:27  ·  Interrupted")).toBe("interrupted");
    expect(btwStatusFromMeta("Oct 21, 2026, 18:14")).toBe("complete");
  });

  it("失败的一问：状态 error，错误文字取 omp.btw.error；仍可 follow-up，没有 stop", () => {
    const view = lastViewOf(
      failed.steps.filter((step) => step.userEvents <= 1),
      "Reply with exactly the word: pong",
    );
    expect(view.turns[0]).toMatchObject({ status: "error", answer: "" });
    expect(view.turns[0]!.error).toMatch(/^401 Authentication Fails/);
    expect(view.buttons["follow-up"]).toBeDefined();
    expect(view.buttons["stop"]).toBeUndefined();
  });

  it("对失败话题追问也失败：两问都是 error，error 字段各自带着", () => {
    const view = failed.steps.findLast((step) => step.view?.turns.length === 2)!.view!;
    expect(view.turns.map((turn) => [turn.kind, turn.status])).toEqual([
      ["question", "error"],
      ["followUp", "error"],
    ]);
    const record = viewToRecord(view, "t1", undefined, 1000)!;
    expect(record.status).toBe("error");
    expect(record.error).toMatch(/401/);
    expect(record.followUps).toHaveLength(1);
    expect(record.followUps![0]).toMatchObject({ question: "again", status: "error" });
  });
});

describe("弹窗 → 记录 → 事件", () => {
  it("viewToRecord：保留已有记录的创建时间和 leafId，内容没变时 updatedAt 不动", () => {
    const view = lastViewOf(pong.steps, "Reply with exactly the word: ping");
    const first = viewToRecord(view, "r1", undefined, 1000)!;
    expect(first).toMatchObject({
      id: "r1",
      leafId: null,
      question: "Reply with exactly the word: ping",
      answer: "ping",
      status: "complete",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const again = viewToRecord(view, "r1", { ...first, leafId: "leaf" }, 5000)!;
    expect(again).toMatchObject({ createdAt: 1000, updatedAt: 1000, leafId: "leaf" });
  });

  it("resolveViewRecordId：有 list 用选中项的 id；只有一个话题时按第一问找最新的同问话题", () => {
    const single = pong.steps.find(
      (step) => step.view?.list === null && step.view?.turns[0]?.question === "Reply with exactly the word: pong",
    )!.view!;
    const topic = (id: string, createdAt: number): BtwHistoryRecord => ({
      id,
      leafId: null,
      question: "Reply with  exactly the word: pong ",
      answer: "",
      status: "complete",
      createdAt,
      updatedAt: createdAt,
    });
    expect(resolveViewRecordId(single, [topic("old", 1), topic("new", 2)])).toBe("new");
    expect(resolveViewRecordId(single, [])).toBeNull();
    const withList = pong.steps.find((step) => step.view?.list)!.view!;
    expect(resolveViewRecordId(withList, [])).toBe(withList.list!.selected);
  });

  it("btwEventsFor：新记录 → record；答案只是追加 → delta；别的变化 → record；没变 → 无事件；投影始终和记录一致", () => {
    const views = pong.steps
      .map((step) => step.view)
      .filter((view): view is BtwView => view?.turns[0]?.question === "Write a 400 word essay about trees.");
    let mirror: readonly BtwHistoryRecord[] = [];
    let previous: BtwHistoryRecord | undefined;
    const kinds = new Set<string>();
    for (const view of views) {
      const record = viewToRecord(view, "essay", previous, 1000 + kinds.size)!;
      for (const event of btwEventsFor(previous, record)) {
        kinds.add(event.type);
        mirror = applyBtwEvent(mirror, event);
      }
      expect(mirror[0]!.answer).toBe(record.answer);
      expect(mirror[0]!.status).toBe(record.status);
      previous = record;
    }
    expect([...kinds].sort()).toEqual(["delta", "record"]);
    expect(btwEventsFor(previous, previous!)).toEqual([]);
  });

  it("normalizeBtwQuestion：空白折叠、去首尾", () => {
    expect(normalizeBtwQuestion("  a \n b\t c ")).toBe("a b c");
  });
});

// omp 18.12.5 实测落盘的 btw-history/entry-<id>.json（录制 btw.jsonl 同一次运行，两个话题；第一个带追问）。
const ENTRY_PONG = `{"question":"Reply with exactly the word: pong","answer":"pong","status":"complete","createdAt":1792607787172,"updatedAt":1792607788252,"id":"15af3d5a2937f9fd","leafId":"128a0b51","followUps":[{"question":"Say gamma","answer":"gamma","status":"complete","createdAt":1792607813434,"updatedAt":1792607814500}]}`;
const ENTRY_PING = `{"question":"Reply with exactly the word: ping","answer":"ping","status":"complete","createdAt":1792607801182,"updatedAt":1792607802244,"id":"15af3d67d7b7f9ff","leafId":"eb55420a"}`;

describe("磁盘上的 btw-history", () => {
  it("parseBtwEntry：话题 + 追问；缺 leafId 当 null；认不出的返回 null", () => {
    const record = parseBtwEntry(ENTRY_PONG)!;
    expect(record).toMatchObject({ id: "15af3d5a2937f9fd", leafId: "128a0b51", status: "complete" });
    expect(record.followUps).toEqual([
      {
        question: "Say gamma",
        answer: "gamma",
        status: "complete",
        createdAt: 1792607813434,
        updatedAt: 1792607814500,
      },
    ]);
    expect(parseBtwEntry(ENTRY_PING)!.followUps).toBeUndefined();
    const noLeaf = { ...JSON.parse(ENTRY_PING), leafId: undefined };
    expect(parseBtwEntry(JSON.stringify(noLeaf))!.leafId).toBeNull();
    expect(parseBtwEntry("{")).toBeNull();
    expect(parseBtwEntry(JSON.stringify({ ...JSON.parse(ENTRY_PING), status: "weird" }))).toBeNull();
    expect(parseBtwEntry(JSON.stringify({ ...JSON.parse(ENTRY_PING), id: "" }))).toBeNull();
    expect(parseBtwEntry(JSON.stringify({ ...JSON.parse(ENTRY_PING), followUps: [{}] }))).toBeNull();
  });

  it("mergeBtwDisk：临时 id 的记录按第一问换成磁盘上的真 id；磁盘的记录补进来，从新到旧", () => {
    const disk = [parseBtwEntry(ENTRY_PONG)!, parseBtwEntry(ENTRY_PING)!];
    const live: BtwHistoryRecord = {
      id: "live:1",
      leafId: null,
      question: "Reply with exactly the word: ping",
      answer: "ping",
      status: "complete",
      createdAt: 1792607801000,
      updatedAt: 1792607801500,
    };
    const merged = mergeBtwDisk([live], disk);
    expect(merged.remap.get("live:1")).toBe("15af3d67d7b7f9ff");
    expect(merged.records.map((record) => record.id)).toEqual(["15af3d67d7b7f9ff", "15af3d5a2937f9fd"]);
    expect(merged.records[0]).toEqual(disk[1]);
    expect(merged.records.some((record) => isProvisionalBtwId(record.id))).toBe(false);
  });

  it("mergeBtwDisk：镜像里还在回答的以镜像为准（借磁盘的创建时间和 leafId）；磁盘上写着 running 又没人在跑 → interrupted", () => {
    const ping = parseBtwEntry(ENTRY_PING)!;
    const diskRunning: BtwHistoryRecord = { ...ping, answer: "", status: "running" };
    const live: BtwHistoryRecord = { ...ping, answer: "pi", status: "running", leafId: null, createdAt: 5 };
    expect(mergeBtwDisk([live], [diskRunning]).records).toEqual([
      { ...live, createdAt: ping.createdAt, leafId: ping.leafId },
    ]);
    expect(mergeBtwDisk([], [diskRunning]).records[0]!.status).toBe("interrupted");
    const orphanFollowUp = mergeBtwDisk(
      [],
      [{ ...ping, followUps: [{ question: "q", answer: "", status: "running", createdAt: 1, updatedAt: 1 }] }],
    );
    expect(orphanFollowUp.records[0]!.followUps![0]!.status).toBe("interrupted");
  });

  it("mergeBtwDisk：谁的问答多以谁为准——镜像多一问（磁盘还没写追问）用镜像，磁盘多一问（终端里追问过）用磁盘", () => {
    const pong = parseBtwEntry(ENTRY_PONG)!;
    const { followUps: _followUps, ...bare } = pong;
    expect(mergeBtwDisk([pong], [bare]).records[0]!.followUps).toHaveLength(1);
    expect(mergeBtwDisk([bare], [pong]).records[0]!.followUps).toHaveLength(1);
    expect(mergeBtwDisk([bare], [pong]).records[0]).toEqual(pong);
  });

  it("mergeBtwDisk：镜像里已结束、磁盘上还是 running（磁盘落后一拍）→ 以镜像为准，不标 interrupted", () => {
    const ping = parseBtwEntry(ENTRY_PING)!;
    const merged = mergeBtwDisk([ping], [{ ...ping, answer: "", status: "running" }]);
    expect(merged.records[0]).toMatchObject({ status: "complete", answer: "ping" });
  });
});
