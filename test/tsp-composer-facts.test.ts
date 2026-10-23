// omp 输入框卡片和状态区里的事实（shared/tsp/composer-facts.ts）：omp 18.12.6 真实录制逐帧
// （fixtures/tsp/composer-{modes,loop,retry,interrupted}.jsonl 是 2026-10-23 在临时 agent 目录里用真实 omp + deepseek-v4-flash 录的；
// compact-ok / hub-steer / session-tree-summarize 是更早的录制，用来确认这些事实不会被别的节点误触发）。
import { describe, expect, it } from "vitest";
import {
  deriveComposerFacts,
  estimateRetrySeconds,
  modeCommandBlocker,
  modeCommandDone,
  parseLoaderText,
  parseModeText,
  sameComposerFacts,
  type ComposerFacts,
  type ComposerMode,
} from "../src/shared/tsp/composer-facts.ts";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { deriveWorkingLabel } from "../src/shared/tsp/working.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";
import { parseTaskCommand, taskCommandText } from "../src/shared/omp-output/index.ts";

interface Step {
  /** 相对录制开头的秒数。 */
  at: number;
  facts: ComposerFacts;
}

/** 回放整份录制，每应用一帧记一次事实。 */
function replay(name: string): Step[] {
  const lines = loadTspFixture(name);
  const start = lines[0]!.t;
  const doc = createDocument();
  return tspDocMessages(lines).map(({ t, message }) => {
    applyMessage(doc, message);
    return { at: (t - start) / 1000, facts: deriveComposerFacts(doc) };
  });
}

/** 输入框卡片在时，某个字段的取值序列（相邻去重）。 */
function sequence<T>(steps: readonly Step[], pick: (facts: ComposerFacts) => T, onlyWithComposer = true): string[] {
  const out: string[] = [];
  for (const { facts } of steps) {
    if (onlyWithComposer && !facts.composer) continue;
    const label = JSON.stringify(pick(facts));
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out;
}

const loop = (
  state: "running" | "waiting" | "paused",
  limit: unknown,
  condition: { until: boolean; command: string } | null = null,
) => JSON.stringify({ kind: "loop", state, limit, condition });

describe("模式：/plan /vibe /loop 的真实录制", () => {
  const steps = replay("composer-modes");

  it("计划模式 开 → 暂停（Plan (paused)）→ 关闭；vibe 开 → 关；循环带条件 / 带时长 → 关", () => {
    expect(sequence(steps, (facts) => facts.mode)).toEqual([
      "null",
      JSON.stringify({ kind: "plan", paused: false }),
      JSON.stringify({ kind: "plan", paused: true }),
      "null",
      JSON.stringify({ kind: "vibe" }),
      "null",
      loop("waiting", { kind: "iterations", remaining: 3, initial: 3 }, { until: true, command: "echo ok" }),
      "null",
      loop("waiting", { kind: "duration", secondsLeft: 120 }),
      "null",
    ]);
  });

  it("模式只在输入框卡片里读：卡片不在（刚启动那一帧）为 composer:false、mode:null", () => {
    expect(steps[0]!.facts).toMatchObject({ composer: false, mode: null, extStatuses: [] });
  });

  it("没有扩展状态、没有速度、没有重试 / 压缩 / 聚焦 / 中断提示", () => {
    for (const { facts } of steps)
      expect(facts).toMatchObject({
        extStatuses: [],
        rate: null,
        retry: null,
        compaction: null,
        focus: null,
        interrupted: false,
      });
  });
});

describe("循环、扩展状态、速度的真实录制（composer-loop）", () => {
  const steps = replay("composer-loop");

  it("两个扩展写的状态（hook-0、hook-1）按顺序出现，之后一直在", () => {
    const sequences = sequence(steps, (facts) => facts.extStatuses);
    expect(sequences).toEqual(["[]", JSON.stringify(["Indexed 128 files", "LSP ready"])]);
  });

  it("循环：等提示 → 运行（剩余 3 → 0）→ 暂停（图标 pause，0/3）→ /loop 关闭", () => {
    const limit = (remaining: number) => ({ kind: "iterations", remaining, initial: 3 });
    expect(sequence(steps, (facts) => facts.mode)).toEqual([
      "null",
      loop("waiting", limit(3)),
      loop("running", limit(3)),
      loop("running", limit(2)),
      loop("running", limit(1)),
      loop("running", limit(0)),
      loop("paused", limit(0)),
      "null",
    ]);
  });

  it("速度：开了 composer.tokenRate 的生成中出现 omp.composer.rate，值是 tok/s（一位小数）", () => {
    const rates = steps.map((step) => step.facts.rate).filter((rate): rate is number => rate !== null);
    expect(rates[0]).toBe(42.2);
    expect(rates.length).toBeGreaterThan(3);
    expect(Math.max(...rates)).toBeGreaterThan(44);
    // 没开始生成之前没有速度节点。
    expect(steps.find((step) => step.at < 17)?.facts.rate).toBeNull();
  });
});

describe("自动重试倒计时（composer-retry：本地假代理对 CONNECT 回 502，retry.baseDelayMs=4000）", () => {
  const steps = replay("composer-retry");
  const retries = steps.filter((step) => step.facts.retry !== null);

  it("第 1 次重试：圆环从 1 走到 0.08，每 0.5 秒一帧；点取消 = omp 的 interrupt 动作", () => {
    const first = retries.filter((step) => step.facts.retry?.attempt === 1);
    expect(first[0]!.facts.retry).toMatchObject({ attempt: 1, max: 3, remaining: 1, cancel: { act: "interrupt" } });
    expect(first.at(-1)!.facts.retry?.remaining).toBe(0.08);
    const values = first.map((step) => step.facts.retry!.remaining!);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("第 2 次重试等得更久（指数退避）：圆环走得更慢", () => {
    const second = retries.filter((step) => step.facts.retry?.attempt === 2);
    expect(second.length).toBeGreaterThan(retries.filter((step) => step.facts.retry?.attempt === 1).length);
    expect(second[0]!.facts.retry).toMatchObject({ attempt: 2, max: 3 });
  });

  it("重试等待结束后（再次请求）工作行回到普通的 Working…：不再是重试", () => {
    const afterFirst = steps.find((step) => step.at > 38.2 && step.at < 38.6);
    expect(afterFirst?.facts.retry).toBeNull();
  });

  it("从圆环估剩余秒数：第一帧（满环）和当前帧，已走不到 5% 估不了", () => {
    const first = retries[0]!;
    const at = (seconds: number) => retries.find((step) => step.at >= first.at + seconds)!;
    const sample = (step: Step) => ({ at: step.at * 1000, remaining: step.facts.retry!.remaining! });
    // 第 1 次的总等待约 3.85 秒（4 秒的退避），走了 1.5 秒后还剩约 2.4 秒 → 向上取整 3。
    expect(estimateRetrySeconds(sample(first), sample(at(1.5)))).toBe(3);
    expect(estimateRetrySeconds(sample(first), sample(at(3.5)))).toBe(1);
    expect(estimateRetrySeconds(sample(first), sample(first))).toBeNull();
    expect(estimateRetrySeconds({ at: 0, remaining: 1 }, { at: 100, remaining: 0.97 })).toBeNull();
  });
});

describe("上一轮被中断的重试提示（composer-interrupted：bash 跑到一半按 Esc）", () => {
  const steps = replay("composer-interrupted");

  it("Esc 之后状态区出现 omp.hint.retry；之前没有", () => {
    expect(sequence(steps, (facts) => facts.interrupted)).toEqual(["false", "true"]);
    expect(steps.find((step) => step.facts.interrupted)!.at).toBeGreaterThan(9);
  });
});

describe("压缩、聚焦、loader 不会被别的节点误触发", () => {
  it("手动压缩：工作行里出现 progress，标签 Compacting context…，Stop 是 interrupt 动作", () => {
    const steps = replay("compact-ok");
    expect(sequence(steps, (facts) => facts.compaction?.label ?? null)).toEqual([
      "null",
      '"Compacting context…"',
      "null",
    ]);
    expect(steps.find((step) => step.facts.compaction)!.facts.compaction?.stop).toMatchObject({ act: "interrupt" });
    for (const { facts } of steps) expect(facts.retry).toBeNull();
  });

  it("普通运行的 Working… 行既不是重试也不是压缩", () => {
    for (const name of ["task", "approval", "agent-progress"]) {
      for (const { facts } of replay(name)) expect(facts).toMatchObject({ retry: null, compaction: null });
    }
  });

  it("聚焦子代理：omp.composer.focus 在时 focus 是子代理名，退出后没有", () => {
    const steps = replay("hub-steer");
    expect(sequence(steps, (facts) => facts.focus?.name ?? null)).toEqual(["null", '"Beta"', "null"]);
    expect(steps.find((step) => step.facts.focus)!.facts.focus?.exit?.act).toBe("focus:Main");
  });

  it("分支摘要的 omp.loader 不是压缩 / 重试", () => {
    for (const { facts } of replay("session-tree-summarize"))
      expect(facts).toMatchObject({ retry: null, compaction: null });
  });

  it("目标事实行（Goal …）是 goal 模式，不是 composerMode", () => {
    const steps = replay("goal-pause-resume");
    const goalSteps = steps.filter((step) => step.facts.mode?.kind === "goal");
    expect(goalSteps.length).toBeGreaterThan(0);
    expect(goalSteps[0]!.facts.mode).toEqual({
      kind: "goal",
      fact: { status: "active", usedLabel: "0", budgetLabel: null },
    });
  });
});

describe("按片段名认模式 / 扩展状态：别的片段文字再像也不算", () => {
  function docWithFacts(segments: { name: string; text: string; icon?: string }[]): TspDocument {
    const doc = createDocument();
    const children = segments.map(({ name, text, icon }) => ({
      id: `j.bar/extras/${name}`,
      k: "seg",
      p: { role: "omp.composer.fact", priority: 1, spans: [{ t: text }], ...(icon && { icon }) },
    }));
    applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline", title: "omp", role: "omp.session" } });
    applyMessage(doc, {
      verb: "f",
      body: {
        sf: "s:1",
        s: 1,
        ops: [
          ["add", "main", "s:1", null, { id: "main", k: "col" }],
          ["add", "dock", "s:1", null, { id: "dock", k: "col" }],
          [
            "add",
            "e",
            "dock",
            null,
            {
              id: "e",
              k: "col",
              c: [
                {
                  id: "j",
                  k: "col",
                  p: { role: "omp.editor" },
                  c: [{ id: "j.bar", k: "row", c: [{ id: "j.bar/extras", k: "status", c: children }] }],
                },
              ],
            },
          ],
        ],
      },
    } as never);
    return doc;
  }

  it("分支叫 Vibe / Plan / Loop: running 的 git 事实不是模式", () => {
    for (const text of ["Vibe", "Plan", "Loop: running 1/2", "Goal 12"]) {
      const facts = deriveComposerFacts(docWithFacts([{ name: "git", text, icon: "branch" }]));
      expect(facts).toMatchObject({ composer: true, mode: null, extStatuses: [] });
    }
  });

  it("mode 片段读成模式，hook-N 读成扩展状态（去掉图标字形，空的不要），其它片段忽略", () => {
    const facts = deriveComposerFacts(
      docWithFacts([
        { name: "git", text: "master" },
        { name: "mode", text: "Prewalk" },
        { name: "hook-0", text: "\uE0A0 Indexed" },
        { name: "hook-1", text: "\uE0A0" },
        { name: "collab", text: "2 guests" },
        { name: "hook-2", text: "LSP ready" },
      ]),
    );
    expect(facts.mode).toEqual({ kind: "prewalk" });
    expect(facts.extStatuses).toEqual(["Indexed", "LSP ready"]);
  });
});

describe("parseModeText：omp 状态行 mode 片段的每种写法", () => {
  it.each<[string, unknown, ComposerMode | null]>([
    ["Plan", undefined, { kind: "plan", paused: false }],
    ["Plan (paused)", "pause", { kind: "plan", paused: true }],
    ["Prewalk", undefined, { kind: "prewalk" }],
    ["Vibe", undefined, { kind: "vibe" }],
    [
      "Goal 2.1K/1.5K",
      "warning",
      { kind: "goal", fact: { status: "budget-limited", usedLabel: "2.1K", budgetLabel: "1.5K" } },
    ],
    [
      "Loop running 2/5 while: bun test",
      undefined,
      {
        kind: "loop",
        state: "running",
        limit: { kind: "iterations", remaining: 2, initial: 5 },
        condition: { until: false, command: "bun test" },
      },
    ],
    [
      "Loop paused 1h30m left until: until: x",
      "pause",
      {
        kind: "loop",
        state: "paused",
        limit: { kind: "duration", secondsLeft: 5400 },
        condition: { until: true, command: "until: x" },
      },
    ],
    [
      "Loop: next prompt repeats 45s left",
      undefined,
      { kind: "loop", state: "waiting", limit: { kind: "duration", secondsLeft: 45 }, condition: null },
    ],
    [
      "Loop: next prompt repeats 2m5s left",
      undefined,
      { kind: "loop", state: "waiting", limit: { kind: "duration", secondsLeft: 125 }, condition: null },
    ],
    ["Loop running", undefined, { kind: "loop", state: "running", limit: null, condition: null }],
    ["Planning", undefined, null],
    ["master", undefined, null],
  ])("%s", (text, icon, expected) => {
    expect(parseModeText(text, icon)).toEqual(expected);
  });
});

describe("模式命令：发之前看当前模式，发出后看模式变没变", () => {
  const plan: ComposerMode = { kind: "plan", paused: false };
  const paused: ComposerMode = { kind: "plan", paused: true };
  const running = { kind: "loop", state: "running", limit: null, condition: null } as const;

  it("/loop 在循环开着时是关闭，不能当「开启」发；循环没开时不能「关闭」", () => {
    expect(modeCommandBlocker("loopStart", running)).toBe("loop mode is already on");
    expect(modeCommandBlocker("loopStop", null)).toBe("loop mode is not on");
    expect(modeCommandBlocker("loopStart", null)).toBeNull();
    expect(modeCommandBlocker("loopStop", running)).toBeNull();
    expect(modeCommandBlocker("plan", null)).toBeNull();
  });

  it("/plan：模式变了或 omp 弹了确认 / 评审弹窗算生效；没变（omp 说 Exit goal mode first.）不算", () => {
    expect(modeCommandDone("plan", null, plan, false)).toBe(true);
    expect(modeCommandDone("plan", plan, paused, false)).toBe(true);
    expect(modeCommandDone("plan", paused, null, false)).toBe(true);
    expect(modeCommandDone("plan", plan, plan, true)).toBe(true);
    expect(modeCommandDone("plan", null, null, false)).toBe(false);
    expect(modeCommandDone("vibe", null, { kind: "vibe" }, false)).toBe(true);
  });

  it("/plan-review 只看弹窗；/loop 开启看模式变成 loop、关闭看不再是 loop", () => {
    expect(modeCommandDone("planReview", plan, plan, false)).toBe(false);
    expect(modeCommandDone("planReview", plan, plan, true)).toBe(true);
    expect(modeCommandDone("loopStart", null, running, false)).toBe(true);
    expect(modeCommandDone("loopStart", null, null, false)).toBe(false);
    expect(modeCommandDone("loopStop", running, null, false)).toBe(true);
    expect(modeCommandDone("loopStop", running, running, false)).toBe(false);
  });
});

describe("sameComposerFacts", () => {
  it("同一份文档推出的事实相同；圆环的值变了就不同", () => {
    const steps = replay("composer-retry").filter((step) => step.facts.retry !== null);
    expect(sameComposerFacts(steps[0]!.facts, steps[0]!.facts)).toBe(true);
    expect(sameComposerFacts(steps[0]!.facts, steps[1]!.facts)).toBe(false);
  });
});

describe("模式命令的文本（TaskCommand → /命令）", () => {
  const text = (command: unknown) => taskCommandText(parseTaskCommand(command));

  it("/plan /plan-review /vibe /loop", () => {
    expect(text({ kind: "plan" })).toBe("/plan");
    expect(text({ kind: "planReview" })).toBe("/plan-review");
    expect(text({ kind: "vibe" })).toBe("/vibe");
    expect(text({ kind: "loopStop" })).toBe("/loop");
    expect(text({ kind: "loopStart" })).toBe("/loop");
  });

  it("/loop [次数|时长] [--while|--until '<命令>'] [提示]：顺序固定，条件命令加单引号", () => {
    expect(text({ kind: "loopStart", limit: "10" })).toBe("/loop 10");
    expect(text({ kind: "loopStart", limit: "1h30m", prompt: "fix tests" })).toBe("/loop 1h30m fix tests");
    expect(
      text({
        kind: "loopStart",
        limit: "20",
        condition: { until: true, command: "bun test" },
        prompt: "fix the failing tests",
      }),
    ).toBe("/loop 20 --until 'bun test' fix the failing tests");
    expect(text({ kind: "loopStart", condition: { until: false, command: "test -f done.txt" } })).toBe(
      "/loop --while 'test -f done.txt'",
    );
  });

  it('命令里有单引号时改用双引号并转义 \\ " $ `', () => {
    expect(text({ kind: "loopStart", condition: { until: true, command: "grep 'a b' x" } })).toBe(
      `/loop --until "grep 'a b' x"`,
    );
    expect(text({ kind: "loopStart", condition: { until: true, command: "echo '$HOME' \"x\" \\ `y`" } })).toBe(
      `/loop --until "echo '\\$HOME' \\"x\\" \\\\ \\\`y\\\`"`,
    );
  });

  it("不合法的参数在主进程校验时就拒绝，不拼进命令行", () => {
    for (const bad of [
      { kind: "loopStart", limit: "10 minutes" },
      { kind: "loopStart", limit: "-1" },
      { kind: "loopStart", limit: "m10" },
      { kind: "loopStart", condition: { until: true, command: "" } },
      { kind: "loopStart", condition: { until: true, command: "a\nb" } },
      { kind: "loopStart", condition: { command: "x" } },
      { kind: "loopStart", prompt: "--until x" },
      { kind: "loopStart", prompt: "3 apples" },
      { kind: "loopStart", prompt: "a\nb" },
    ])
      expect(() => parseTaskCommand(bad), JSON.stringify(bad)).toThrow();
    // 有次数（或条件）时，提示可以以数字开头。
    expect(text({ kind: "loopStart", limit: "2", prompt: "3 apples" })).toBe("/loop 2 3 apples");
  });
});

describe("空闲 loader（session-tree-summarize 录制：分支摘要）", () => {
  it("文字去掉图标字形和取消提示，取消提示单独认出来（界面画取消按钮、发 Esc）", () => {
    expect(parseLoaderText("Summarizing branch... (to cancel)")).toEqual({
      text: "Summarizing branch...",
      cancellable: true,
    });
    expect(parseLoaderText("Summarizing branch... (esc to cancel)").cancellable).toBe(true);
    expect(parseLoaderText("Creating worktree…")).toEqual({ text: "Creating worktree…", cancellable: false });
    const doc = createDocument();
    const labels = new Set<string | null>();
    for (const { message } of tspDocMessages(loadTspFixture("session-tree-summarize"))) {
      applyMessage(doc, message);
      labels.add(deriveWorkingLabel(doc));
    }
    expect([...labels]).toContain("Summarizing branch...");
    for (const label of labels) expect(label ?? "").not.toMatch(/to cancel|[\uE000-\uF8FF]/);
  });
});
