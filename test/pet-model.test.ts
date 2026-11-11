// 桌面宠物的纯逻辑：骨的确定性和稀有度分布、成长的每日上限 / 连续签到 / 进化阈值、任务状态汇总和事件识别、pet.json 的容错。
import { describe, expect, test } from "vitest";
import type { TaskState } from "../src/shared/ipc.ts";
import { rollBones } from "../src/shared/pet/bones.ts";
import {
  applyAchievement,
  applyEvent,
  applyOutput,
  emptyGrowth,
  levelOf,
  outputXp,
  stageOf,
  xpForLevel,
  type Growth,
} from "../src/shared/pet/growth.ts";
import { hatMinRarity, rarities, rarityInfo, type Rarity } from "../src/shared/pet/model.ts";
import { eventToVoice, PetTaskTracker, summarizeMood } from "../src/shared/pet/mood.ts";
import { addSpend, emptySpend, parsePetRecord, rehatched, spendOn } from "../src/main/pet/pet-store.ts";
import { chooseVoiceModel, parseJsonOutput } from "../src/main/pet/pet-voice.ts";

const seed = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

/** 任务状态里宠物看的那几项；默认是个还没用量、没待办、没 PR 的任务。 */
const tracked = (
  status: TaskState["status"],
  extra: Partial<Pick<TaskState, "sessionUsage" | "todoPhases" | "prNumber" | "title">> = {},
) => ({
  id: "t1" as TaskState["id"],
  status,
  title: "修 bug",
  cwd: "/repo",
  sessionUsage: null,
  todoPhases: [],
  prNumber: null,
  ...extra,
});

const usage = (output: number): TaskState["sessionUsage"] => ({
  tokens: { input: 100, output, cacheRead: 0, cacheWrite: 0, total: 100 + output },
  cost: 0,
  premiumRequests: 0,
});

describe("骨", () => {
  test("同一个种子永远抽出同一只，不同种子会不同", () => {
    expect(rollBones(seed(1))).toEqual(rollBones(seed(1)));
    const distinct = new Set(Array.from({ length: 50 }, (_, index) => JSON.stringify(rollBones(seed(index)))));
    expect(distinct.size).toBeGreaterThan(45);
  });

  test("稀有度分布贴近权重，帽子不越级，属性不低于下限附近、不超过 100", () => {
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    const total = 20_000;
    for (let index = 0; index < total; index += 1) {
      const bones = rollBones(seed(index));
      counts[bones.rarity] += 1;
      if (bones.rarity === "common") expect(bones.hat).toBe("none");
      else {
        expect(bones.hat).not.toBe("none");
        if (bones.hat !== "none")
          expect(rarities.indexOf(hatMinRarity[bones.hat])).toBeLessThanOrEqual(rarities.indexOf(bones.rarity));
      }
      for (const value of Object.values(bones.stats)) {
        expect(value).toBeGreaterThanOrEqual(Math.max(1, rarityInfo[bones.rarity].floor - 4));
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    for (const rarity of rarities) expect(counts[rarity] / total).toBeCloseTo(rarityInfo[rarity].weight / 100, 1);
  });
});

describe("成长", () => {
  const day = (date: string, hour = 10) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);

  test("每天第一次事件先签到；同一天的同种事件超过上限不再给经验", () => {
    let growth: Growth = emptyGrowth();
    const first = applyEvent(growth, "gate", day("2026-11-10"));
    expect(first.gained).toBe(30 + 5);
    growth = first.growth;
    for (let index = 1; index < 20; index += 1) growth = applyEvent(growth, "gate", day("2026-11-10")).growth;
    expect(growth.today.gate).toBe(20);
    const capped = applyEvent(growth, "gate", day("2026-11-10"));
    expect(capped.gained).toBe(0);
    expect(capped.growth.totals.gate).toBe(20);
    // 第二天上限重置，连续签到经验变多
    const next = applyEvent(capped.growth, "gate", day("2026-11-11"));
    expect(next.growth.streak).toBe(2);
    expect(next.gained).toBe(35 + 5);
  });

  test("输出 token 按当天累计取对数：分几次给和一次给的经验一样；第二天从头算", () => {
    const start = applyEvent(emptyGrowth(), "pet", day("2026-11-10")).growth;
    let split = start;
    let gained = 0;
    for (const tokens of [20_000, 80_000, 100_000]) {
      const step = applyOutput(split, tokens, day("2026-11-10"));
      gained += step.gained;
      split = step.growth;
    }
    expect(gained).toBe(applyOutput(start, 200_000, day("2026-11-10")).gained);
    expect(gained).toBe(outputXp(200_000));
    expect(split.totals.output).toBe(200_000);
    // 越多越难：当天第二个 20 万比第一个给得少；跑完一轮本身不给经验
    expect(applyOutput(split, 200_000, day("2026-11-10")).gained).toBeLessThan(gained);
    expect(applyEvent(split, "turn", day("2026-11-10")).gained).toBe(0);
    const nextDay = applyOutput(split, 200_000, day("2026-11-11"));
    expect(nextDay.growth.today.output).toBe(200_000);
    expect(nextDay.gained).toBe(35 + outputXp(200_000));
  });

  test("成就同一个 key 只算一次；超过当天上限也记下 key", () => {
    const first = applyAchievement(emptyGrowth(), "pr", "pr:/repo#12", day("2026-11-10"));
    expect(first?.gained).toBe(30 + 100);
    expect(applyAchievement(first!.growth, "pr", "pr:/repo#12", day("2026-11-10"))).toBeNull();
    let growth = first!.growth;
    for (let index = 13; index < 17; index += 1)
      growth = applyAchievement(growth, "pr", `pr:/repo#${index}`, day("2026-11-10"))!.growth;
    const capped = applyAchievement(growth, "pr", "pr:/repo#99", day("2026-11-10"));
    expect(capped?.gained).toBe(0);
    expect(capped?.growth.achieved).toContain("pr:/repo#99");
  });

  test("断了一天连续签到从 1 重新算；不改传入的对象", () => {
    const start = applyEvent(emptyGrowth(), "gate", day("2026-11-01")).growth;
    const snapshot = structuredClone(start);
    const later = applyEvent(start, "gate", day("2026-11-03")).growth;
    expect(later.streak).toBe(1);
    expect(start).toEqual(snapshot);
  });

  test("属性按事件次数成长：recovered 每次 +1 调试，出错不给经验只涨混乱", () => {
    let growth = applyEvent(emptyGrowth(), "recovered", day("2026-11-10")).growth;
    expect(growth.statGrowth.debugging).toBe(1);
    const error = applyEvent(growth, "error", day("2026-11-10"));
    expect(error.gained).toBe(0);
    growth = error.growth;
    expect(growth.statGrowth.chaos).toBe(1);
  });

  test("等级和阶段阈值：Lv5 破壳、Lv15 成年、Lv30 完全体，跨阶段时报告进化", () => {
    expect(levelOf(xpForLevel(5) - 1)).toBe(4);
    expect(levelOf(xpForLevel(5))).toBe(5);
    expect([1, 4, 5, 14, 15, 29, 30].map(stageOf)).toEqual(["egg", "egg", "baby", "baby", "adult", "adult", "final"]);
    const almost: Growth = { ...emptyGrowth(), xp: xpForLevel(5) - 5, day: "2026-11-10", streak: 1 };
    almost.today.daily = 1;
    const step = applyEvent(almost, "recovered", day("2026-11-10"));
    expect(step.levelUp).toBe(5);
    expect(step.evolved).toBe("baby");
  });
});

describe("任务状态", () => {
  const task = (status: TaskState["status"]) => ({ status });

  test("汇总优先级：等你 > 出错 > 在跑 > 空闲", () => {
    expect(summarizeMood([])).toBe("idle");
    expect(summarizeMood([task("idle"), task("starting")])).toBe("running");
    expect(summarizeMood([task("running"), task("error")])).toBe("error");
    expect(summarizeMood([task("error"), task("needs_you"), task("running")])).toBe("waiting");
  });

  test("认出跑完一轮、处理掉的门、出错和出错后跑通", () => {
    const tracker = new PetTaskTracker();
    const kinds = (status: TaskState["status"]) => tracker.update(tracked(status)).map((event) => event.kind);
    expect(kinds("starting")).toEqual([]);
    expect(kinds("idle")).toEqual([]);
    expect(kinds("running")).toEqual([]);
    expect(kinds("needs_you")).toEqual([]);
    expect(kinds("running")).toEqual(["gate"]);
    expect(kinds("idle")).toEqual(["turn"]);
    expect(kinds("error")).toEqual(["error"]);
    expect(kinds("starting")).toEqual([]);
    expect(kinds("idle")).toEqual([]);
    expect(kinds("running")).toEqual([]);
    expect(kinds("idle")).toEqual(["turn", "recovered"]);
    expect(kinds("running")).toEqual([]);
    expect(kinds("idle")).toEqual(["turn"]);
  });

  test("输出 token：第一次读到的累计只当基准，之后给涨出来的部分；读到之前和变小（换了会话）不算", () => {
    const tracker = new PetTaskTracker();
    const output = (sessionUsage: TaskState["sessionUsage"]) =>
      tracker
        .update(tracked("running", { sessionUsage }))
        .flatMap((event) => (event.kind === "output" ? [event.tokens] : []));
    expect(output(null)).toEqual([]);
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    expect(output({ ...usage(0)!, tokens: zero })).toEqual([]);
    expect(output(usage(90_000))).toEqual([]);
    expect(output(usage(91_500))).toEqual([1_500]);
    expect(output(null)).toEqual([]);
    expect(output(usage(91_500))).toEqual([]);
    expect(output(usage(300))).toEqual([]);
    expect(output(usage(800))).toEqual([500]);
  });

  test("待办阶段做完、开了 PR 是成就，只在 agent 干活时算；恢复旧任务时 idle 里读到的旧待办和 PR 只当基准", () => {
    const tracker = new PetTaskTracker();
    const phase = (name: string, ...statuses: ("pending" | "completed" | "abandoned")[]) => ({
      name,
      tasks: statuses.map((status, index) => ({ content: `${name}${index}`, status })),
    });
    const events = (status: TaskState["status"], extra: Parameters<typeof tracked>[1]) =>
      tracker.update(tracked(status, extra)).map((event) => event.kind);
    // 恢复：先空，idle 里才读出旧待办和标题里的 PR 号
    expect(events("starting", {})).toEqual([]);
    expect(events("idle", { todoPhases: [phase("A", "completed")], prNumber: 3 })).toEqual([]);
    const done = [phase("A", "completed"), phase("B", "completed", "abandoned")];
    expect(
      events("running", { todoPhases: [phase("A", "completed"), phase("B", "completed", "pending")], prNumber: 3 }),
    ).toEqual([]);
    expect(events("running", { todoPhases: done, prNumber: 3 })).toEqual(["todoPhase"]);
    // 全部放弃的阶段不算做完；跑完那一下（running → idle）开的 PR 算
    expect(events("running", { todoPhases: [phase("C", "abandoned")], prNumber: 3 })).toEqual([]);
    expect(events("idle", { todoPhases: [], prNumber: 4 })).toEqual(["pr", "turn"]);
    // 同名、内容不同的新一份待办做完还算；用户空闲时在待办板上勾的不算
    expect(events("idle", { todoPhases: [phase("B", "completed")], prNumber: 4 })).toEqual([]);
    expect(events("running", { todoPhases: [phase("B", "completed", "completed", "completed")], prNumber: 4 })).toEqual(
      ["todoPhase"],
    );
  });
});

describe("pet.json", () => {
  test("没有文件或种子坏了换新种子；其余坏字段逐个回落", () => {
    const fresh = parsePetRecord(null);
    expect(fresh.seed).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.soul).toBeNull();
    const parsed = parsePetRecord({
      seed: seed(7),
      soul: { name: "", personality: "x", hatchedAt: 1 },
      growth: {
        xp: -5,
        streak: 2,
        day: "nope",
        totals: { turn: 3.5, gate: 2 },
        statGrowth: { wisdom: 4 },
        achieved: ["pr:/repo#1", 7, ""],
      },
      position: { x: 10.4, y: "a" },
    });
    expect(parsed.seed).toBe(seed(7));
    expect(parsed.soul).toBeNull();
    expect(parsed.growth.xp).toBe(0);
    expect(parsed.growth.streak).toBe(2);
    expect(parsed.growth.day).toBeNull();
    expect(parsed.growth.totals.turn).toBe(0);
    expect(parsed.growth.totals.gate).toBe(2);
    expect(parsed.growth.statGrowth.wisdom).toBe(4);
    expect(parsed.position).toBeNull();
    expect(parsed.growth.achieved).toEqual(["pr:/repo#1"]);
  });
});

describe("说话用的模型", () => {
  test("配了 tiny 用 @tiny，否则退到 smol；读不到配置也交给 omp 解析 @smol", () => {
    expect(chooseVoiceModel({ tiny: "a/b:low", smol: "a/c" })).toBe("@tiny");
    expect(chooseVoiceModel({ smol: "a/c" })).toBe("@smol");
    expect(chooseVoiceModel({ default: "a/d" })).toBe("@smol");
    expect(chooseVoiceModel(null)).toBe("@smol");
  });
});

describe("一次状态变化说哪句", () => {
  test("出错后又跑完一轮：同一批里有 turn 和 recovered，只说 recovered；只处理确认门、只写了 token 不说话", () => {
    const tracker = new PetTaskTracker();
    tracker.update(tracked("running"));
    tracker.update(tracked("error"));
    tracker.update(tracked("running"));
    const events = tracker.update(tracked("idle"));
    expect(events.map((event) => event.kind)).toEqual(["turn", "recovered"]);
    expect(eventToVoice(events)?.kind).toBe("recovered");
    tracker.update(tracked("running"));
    expect(eventToVoice(tracker.update(tracked("idle")))?.kind).toBe("turn");
    tracker.update(tracked("needs_you"));
    expect(eventToVoice(tracker.update(tracked("running")))).toBeNull();
    tracker.update(tracked("running", { sessionUsage: usage(10) }));
    expect(eventToVoice(tracker.update(tracked("running", { sessionUsage: usage(20) })))).toBeNull();
  });

  test("成就优先：同一批里开了 PR 又跑完一轮，说 PR", () => {
    const tracker = new PetTaskTracker();
    tracker.update(tracked("running"));
    const events = tracker.update(tracked("idle", { prNumber: 9 }));
    expect(events.map((event) => event.kind)).toEqual(["pr", "turn"]);
    expect(eventToVoice(events)?.kind).toBe("pr");
  });
});

describe("花费", () => {
  test("json 输出：文字取最后一条 assistant 消息，用量累加；用户消息、坏行、别的事件不算", () => {
    const line = (event: unknown) => JSON.stringify(event);
    const assistant = (text: string, tokens: number, cost: number) =>
      line({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          usage: { totalTokens: tokens, cost: { total: cost } },
        },
      });
    const stdout = [
      line({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
      "Working...",
      "{broken",
      assistant("first", 100, 0.001),
      assistant("second", 50, 0.0005),
      line({ type: "agent_end", messages: [] }),
    ].join("\n");
    const parsed = parseJsonOutput(stdout);
    expect(parsed.text).toBe("second");
    expect(parsed.spend).toEqual({ calls: 1, tokens: 150, cost: expect.closeTo(0.0015, 10) });
    expect(parseJsonOutput("error: no model\n").spend).toBeNull();
  });

  test("今天跨天清零、累计不清；重新孵化不清；坏字段回落为 0", () => {
    // 费用用 2 的幂，加起来是精确的。
    const one = { calls: 1, tokens: 10, cost: 0.125 };
    let spend = addSpend(emptySpend(), one, "2026-11-10");
    spend = addSpend(spend, one, "2026-11-10");
    expect(spendOn(spend, "2026-11-10").today.calls).toBe(2);
    // 第二天还没记账：今天显示 0。
    expect(spendOn(spend, "2026-11-11").today).toEqual({ calls: 0, tokens: 0, cost: 0 });
    spend = addSpend(spend, one, "2026-11-11");
    expect(spendOn(spend, "2026-11-11")).toEqual({ today: one, total: { calls: 3, tokens: 30, cost: 0.375 } });

    const record = parsePetRecord({ seed: seed(1), spend });
    expect(rehatched(record).spend).toEqual(spend);
    const broken = parsePetRecord({ seed: seed(1), spend: { day: "x", total: { calls: -1, tokens: 2.5, cost: "a" } } });
    expect(broken.spend).toEqual(emptySpend());
  });
});
