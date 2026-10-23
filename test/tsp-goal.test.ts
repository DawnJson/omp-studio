// TSP 目标模式（shared/tsp/goal.ts、shared/omp-output/goal.ts、main/tasks/tsp-goal.ts）：omp 18.12.5 真实录制逐帧
// （fixtures/tsp/goal-{pause-resume,drop,budget}.jsonl，真实 omp + deepseek-v4-flash，临时 agent 目录）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskGoal } from "../src/shared/ipc.ts";
import { parseGoalSession } from "../src/shared/omp-output/goal.ts";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { statusToastTexts } from "../src/shared/tsp/composer-state.ts";
import {
  GOAL_TOASTS,
  findGoalDropPrompt,
  parseTokenLabel,
  type GoalDropPrompt,
  taskGoalFromFact,
} from "../src/shared/tsp/goal.ts";
import { deriveComposerFacts, type GoalFact } from "../src/shared/tsp/composer-facts.ts";
import { TspGoalTracker } from "../src/main/tasks/tsp-goal.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

interface GoalDocumentState {
  composer: boolean;
  fact: GoalFact | null;
}

/** 输入框卡片在不在、卡片上的目标事实行（composer-facts 的 `mode`）。 */
function deriveGoalFact(doc: TspDocument): GoalDocumentState {
  const facts = deriveComposerFacts(doc);
  return { composer: facts.composer, fact: facts.mode?.kind === "goal" ? facts.mode.fact : null };
}

interface Step {
  /** 相对录制开头的秒数。 */
  at: number;
  state: GoalDocumentState;
  toasts: string[];
  drop: GoalDropPrompt | null;
}

function replay(name: string): { steps: Step[]; events: { at: number; text: string }[]; doc: TspDocument } {
  const lines = loadTspFixture(name);
  const start = lines[0]!.t;
  const doc = createDocument();
  const steps = tspDocMessages(lines).map(({ t, message }) => {
    applyMessage(doc, message);
    return {
      at: (t - start) / 1000,
      state: deriveGoalFact(doc),
      toasts: statusToastTexts(doc),
      drop: findGoalDropPrompt(doc),
    };
  });
  const events = recordedUserEvents(lines).map(({ t, event }) => ({
    at: (t - start) / 1000,
    text: JSON.stringify(event),
  }));
  return { steps, events, doc };
}

/** 状态变化序列：只记事实行变化（卡片不在时不记）。 */
function factSequence(steps: readonly Step[]): string[] {
  const out: string[] = [];
  for (const { state } of steps) {
    if (!state.composer) continue;
    const label =
      state.fact === null
        ? "none"
        : `${state.fact.status}:${state.fact.usedLabel}${state.fact.budgetLabel === null ? "" : `/${state.fact.budgetLabel}`}`;
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out;
}

describe("parseTokenLabel：omp 的缩写数字", () => {
  it.each([
    ["0", 0],
    ["443", 443],
    ["1.2K", 1200],
    ["11K", 11000],
    ["1.5K", 1500],
    ["2.1K", 2100],
    ["1.5M", 1_500_000],
    ["12k", 12000],
  ])("%s", (label, value) => {
    expect(parseTokenLabel(label)).toBe(value);
  });
  it("认不出的是 null", () => {
    expect(parseTokenLabel("")).toBeNull();
    expect(parseTokenLabel("many")).toBeNull();
    expect(parseTokenLabel("1.2.3K")).toBeNull();
  });
});

describe("目标事实行：goal-pause-resume（omp 18.12.5）", () => {
  const { steps } = replay("goal-pause-resume");

  it("没有目标时输入框卡片在、没有事实行", () => {
    const first = steps.find((step) => step.state.composer);
    expect(first?.state.fact).toBeNull();
  });

  it("创建 → 用量增长 → 暂停（图标 pause）→ 继续（回到进行中）", () => {
    const sequence = factSequence(steps);
    expect(sequence.slice(0, 5)).toEqual(["none", "active:0", "paused:672", "active:672", "active:1.2K"]);
  });

  it("选择器开着时输入框卡片不在文档里：卡片不在不下结论（composer 为 false）", () => {
    const open = steps.filter((step) => !step.state.composer);
    expect(open.length).toBeGreaterThan(0);
    for (const step of open) expect(step.state.fact).toBeNull();
  });

  it("暂停 / 继续的确认 toast 原文匹配 GOAL_TOASTS", () => {
    const toasts = steps.flatMap((step) => step.toasts);
    expect(toasts.some((text) => GOAL_TOASTS.pause.test(text))).toBe(true);
    expect(toasts.some((text) => GOAL_TOASTS.resume.test(text))).toBe(true);
    expect(toasts.some((text) => GOAL_TOASTS.drop.test(text))).toBe(false);
  });

  it("已有目标时再创建：omp 的拒绝 toast 是普通状态 toast", () => {
    const toasts = steps.flatMap((step) => step.toasts);
    expect(toasts).toContain("Goal mode is already active. Use /goal to manage it, or /goal drop to start over.");
  });
});

describe("目标事实行：goal-drop（omp 18.12.5）", () => {
  const { steps, events } = replay("goal-drop");

  it("`/goal drop` 打开 Yes / No 确认选择器，Yes 的 id 是 0", () => {
    const prompts = steps.filter((step) => step.drop !== null);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]?.drop).toMatchObject({ yes: "0" });
    expect(prompts[0]?.state.composer).toBe(false);
  });

  it("录制里点的就是 Yes（activate item 0）", () => {
    const activate = events.find((event) => event.text.includes('"ev":"activate"'));
    expect(activate?.text).toContain('"item":"0"');
  });

  it("确认后 toast Goal dropped.，事实行消失（卡片回来、没有目标）", () => {
    const sequence = factSequence(steps);
    expect(sequence[1]).toBe("active:0");
    expect(sequence).toContain("none");
    expect(steps.flatMap((step) => step.toasts).some((text) => GOAL_TOASTS.drop.test(text))).toBe(true);
    // 放弃之后选择器关了。
    const lastPrompt = steps.map((step) => step.drop).lastIndexOf(steps.find((step) => step.drop)?.drop ?? null);
    expect(steps.slice(lastPrompt + 1).every((step) => step.drop === null)).toBe(true);
  });

  it("目标完成（agent 自己结束）后事实行也消失", () => {
    const sequence = factSequence(steps);
    expect(sequence[sequence.length - 1]).toBe("none");
  });
});

describe("目标事实行：goal-budget（omp 18.12.5）", () => {
  const { steps } = replay("goal-budget");

  it("设了预算后标签是 已用/预算；超预算图标变 warning = budget-limited", () => {
    const sequence = factSequence(steps);
    expect(sequence).toContain("active:443/1.5K");
    expect(sequence).toContain("active:1.2K/1.5K");
    expect(sequence).toContain("budget-limited:2.1K/1.5K");
  });

  it("budget-limited 的目标换算成 TaskGoal：已用 2100、预算 1500", () => {
    const fact = steps.map((step) => step.state.fact).find((candidate) => candidate?.status === "budget-limited");
    expect(fact).toBeTruthy();
    expect(taskGoalFromFact(fact!, null, "x")).toEqual<TaskGoal>({
      id: "tsp",
      objective: "x",
      status: "budget-limited",
      tokensUsed: 2100,
      tokenBudget: 1500,
      timeUsedSeconds: 0,
    });
  });
});

// 真实会话文件里的 mode_change 行（omp 18.12.5；objective 缩短）。
const CREATED =
  '{"type":"mode_change","id":"cfeb760f","parentId":"c8af5bd5","timestamp":"2026-10-21T18:17:04.836Z","runtime":{"version":"18.12.5"},"mode":"goal","data":{"goal":{"id":"15af38eb110e6b91","objective":"Run sleep 25","status":"active","tokensUsed":0,"timeUsedSeconds":0,"createdAt":1792606624836,"updatedAt":1792606624836}}}';
const PAUSED =
  '{"type":"mode_change","id":"7e7bf4b4","parentId":"4da9e944","timestamp":"2026-10-21T18:17:12.846Z","runtime":{"version":"18.12.5"},"mode":"goal_paused","data":{"goal":{"id":"15af38eb110e6b91","objective":"Run sleep 25","status":"paused","tokensUsed":672,"timeUsedSeconds":8,"createdAt":1792606624836,"updatedAt":1792606632846}}}';
const BUDGET =
  '{"type":"mode_change","id":"ab4bc8c9","parentId":"7ac4ae17","timestamp":"2026-10-21T18:20:59.304Z","runtime":{"version":"18.12.5"},"mode":"goal","data":{"goal":{"id":"15af3a89d8f25a23","objective":"Haikus","status":"budget-limited","tokenBudget":1500,"tokensUsed":2103,"timeUsedSeconds":18,"createdAt":1792607049571,"updatedAt":1792607067794}}}';
const COMPLETE =
  '{"type":"mode_change","id":"62465d13","parentId":"67fde74a","timestamp":"2026-10-21T18:21:06.533Z","runtime":{"version":"18.12.5"},"mode":"goal","data":{"goal":{"id":"15af3a89d8f25a23","objective":"Haikus","status":"complete","tokenBudget":1500,"tokensUsed":2656,"timeUsedSeconds":19,"createdAt":1792607049571,"updatedAt":1792607069503}}}';
const NONE =
  '{"type":"mode_change","id":"5ae85125","parentId":"d5e72343","timestamp":"2026-10-21T18:21:07.520Z","runtime":{"version":"18.12.5"},"mode":"none"}';
const MESSAGE = '{"type":"message","id":"m1","message":{"role":"user","content":"hi"}}';

describe("会话文件里的目标记录", () => {
  it("取最后一条目标记录；暂停是 goal_paused", () => {
    const state = parseGoalSession([CREATED, MESSAGE, PAUSED].join("\n"));
    expect(state.cleared).toBe(false);
    expect(state.record).toEqual({
      id: "15af38eb110e6b91",
      objective: "Run sleep 25",
      status: "paused",
      tokensUsed: 672,
      tokenBudget: null,
      timeUsedSeconds: 8,
    });
  });

  it("预算用尽 / 完成 / 之后的 none", () => {
    expect(parseGoalSession(BUDGET).record).toMatchObject({ status: "budget-limited", tokenBudget: 1500 });
    const done = parseGoalSession([BUDGET, COMPLETE, NONE].join("\n"));
    expect(done.record?.status).toBe("complete");
    expect(done.cleared).toBe(true);
  });

  it("放弃目标没有 dropped 记录：只有 none，目标记录停在 active", () => {
    const state = parseGoalSession([CREATED, NONE].join("\n"));
    expect(state).toMatchObject({ cleared: true, record: { status: "active" } });
  });

  it("尾部读取的第一行可能是截断的、最后一行可能写到一半：跳过", () => {
    const state = parseGoalSession(`ssage","id":"x"}\n${CREATED}\n{"type":"mode_change","mode":"go`);
    expect(state.record?.objective).toBe("Run sleep 25");
  });

  it("没有目标记录为 null", () => {
    expect(parseGoalSession(MESSAGE)).toEqual({ record: null, cleared: false });
  });
});

describe("taskGoalFromFact：事实行 + 记录", () => {
  const fact = { status: "paused", usedLabel: "672", budgetLabel: null } as const;
  const record = parseGoalSession(PAUSED).record!;

  it("目标文字、id、时长来自记录，状态和用量以事实行为准", () => {
    expect(taskGoalFromFact(fact, record, "")).toEqual<TaskGoal>({
      id: "15af38eb110e6b91",
      objective: "Run sleep 25",
      status: "paused",
      tokensUsed: 672,
      tokenBudget: null,
      timeUsedSeconds: 8,
    });
  });

  it("记录读不到时用 studio 创建时发出的文字", () => {
    expect(taskGoalFromFact(fact, null, "my goal").objective).toBe("my goal");
  });

  it("上一个目标已完成的记录不串进来", () => {
    const done = parseGoalSession(COMPLETE).record!;
    expect(taskGoalFromFact({ status: "active", usedLabel: "0", budgetLabel: null }, done, "new one")).toMatchObject({
      id: "tsp",
      objective: "new one",
      timeUsedSeconds: 0,
    });
  });
});

describe("TspGoalTracker：回放 goal-pause-resume + 会话文件", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function setup(sessionFile: string | null) {
    const changes: (TaskGoal | null)[] = [];
    let completed = 0;
    const tracker: TspGoalTracker = new TspGoalTracker({
      sessionFile: () => sessionFile,
      changed: () => changes.push(tracker.goal),
      completed: () => completed++,
    });
    return { tracker, changes, completions: () => completed };
  }

  it("事实行出现后读会话文件补上目标文字；暂停 / 继续同步状态；选择器开着不丢目标", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "omp-goal-test-"));
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, `${CREATED}\n`);
    const { tracker } = setup(file);
    const doc = createDocument();
    const seen: string[] = [];
    for (const { message } of tspDocMessages(loadTspFixture("goal-pause-resume"))) {
      applyMessage(doc, message);
      tracker.observe(deriveComposerFacts(doc));
      const goal = tracker.goal;
      const label = goal === null ? "none" : `${goal.status}:${goal.tokensUsed}`;
      if (seen[seen.length - 1] !== label) seen.push(label);
      // 等一次文件读取落地（真实运行里下一帧才会再来）。
      if (goal !== null && goal.objective === "") await vi.waitFor(() => expect(tracker.goal?.objective).not.toBe(""));
    }
    expect(seen.slice(0, 5)).toEqual(["none", "active:0", "paused:672", "active:672", "active:1200"]);
    // 选择器（`/goal`、`/goal drop` 开着）期间输入框卡片不在：目标没有被当成 none 清掉。
    expect(seen.filter((label) => label === "none")).toHaveLength(1); // 只有开头那一个
    expect(tracker.goal).toMatchObject({ status: "active", objective: "Run sleep 25" });
  });

  it("读不到会话文件时用 expectObjective 给的文字", () => {
    const { tracker } = setup(null);
    tracker.expectObjective("typed in studio");
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("goal-pause-resume"))) {
      applyMessage(doc, message);
      tracker.observe(deriveComposerFacts(doc));
      if (tracker.goal !== null) break;
    }
    expect(tracker.goal).toMatchObject({ status: "active", objective: "typed in studio", tokensUsed: 0 });
  });

  it("目标完成（事实行消失、记录是 complete）通知一次；放弃不通知", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "omp-goal-test-"));
    const done = path.join(dir, "done.jsonl");
    writeFileSync(done, [CREATED, COMPLETE, NONE].join("\n"));
    const finished = setup(done);
    const frames = tspDocMessages(loadTspFixture("goal-drop"));
    const doc = createDocument();
    for (const { message } of frames) {
      applyMessage(doc, message);
      finished.tracker.observe(deriveComposerFacts(doc));
    }
    await vi.waitFor(() => expect(finished.completions()).toBe(1), { timeout: 3000 });

    const dropped = path.join(dir, "dropped.jsonl");
    writeFileSync(dropped, [CREATED, NONE].join("\n"));
    const abandoned = setup(dropped);
    const doc2 = createDocument();
    for (const { message } of frames) {
      applyMessage(doc2, message);
      abandoned.tracker.observe(deriveComposerFacts(doc2));
    }
    // 放弃的那份在完成检查（400 ms 之后读文件）走完之前不会通知；等一个完整的检查周期。
    // 真实计时：检查本身就是 setTimeout 之后读盘，没有可注入的时钟（主进程的实现不为测试开接口）。
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(abandoned.completions()).toBe(0);
  });
});
