// 宠物的成长：真实使用攒经验、升级，到阶段等级进化；属性在出生值之上按事件慢慢涨（docs/architecture/pet.md「成长」）。
// 纯函数，主进程在任务状态变化时调用、把结果存进 userData/pet.json。每种事件每天有次数上限，刷不上去。
import { statNames, type Bones, type Stage, type StatName, type Stats } from "./model.ts";

export const xpSources = ["turn", "gate", "recovered", "error", "pet", "daily"] as const;
export type XpSource = (typeof xpSources)[number];

/**
 * 每种事件：给多少经验、每天最多算几次、每算几次给哪项属性 +1。
 * turn = 任务跑完一轮；gate = 等你确认的门处理掉；recovered = 出过错的任务又跑完一轮；error = 任务出错（不给经验，只涨 CHAOS）；
 * pet = 摸一下；daily = 每天第一次有动静时的签到（经验另算，见 dailyXp）。
 */
const rules: Readonly<Record<XpSource, { xp: number; perDay: number; stat: StatName | null; every: number }>> = {
  turn: { xp: 10, perDay: 30, stat: "wisdom", every: 10 },
  gate: { xp: 5, perDay: 20, stat: "patience", every: 3 },
  recovered: { xp: 25, perDay: 4, stat: "debugging", every: 1 },
  error: { xp: 0, perDay: 3, stat: "chaos", every: 1 },
  pet: { xp: 1, perDay: 10, stat: "snark", every: 5 },
  daily: { xp: 0, perDay: 1, stat: null, every: 1 },
};

/** 签到经验：连续天数越多越多，封顶在连续 11 天。 */
const dailyXp = (streak: number) => 30 + 5 * Math.min(streak - 1, 10);

export interface Growth {
  xp: number;
  /** 各事件算进来的总次数（超出当天上限的不算）。 */
  totals: Record<XpSource, number>;
  /** today 计的是哪一天（本地日期 YYYY-MM-DD）；还没有过任何事件时为 null。 */
  day: string | null;
  today: Record<XpSource, number>;
  /** 连续有动静的天数（含 day 当天）。 */
  streak: number;
  statGrowth: Record<StatName, number>;
}

const zeroCounts = (): Record<XpSource, number> => ({ turn: 0, gate: 0, recovered: 0, error: 0, pet: 0, daily: 0 });

export function emptyGrowth(): Growth {
  return {
    xp: 0,
    totals: zeroCounts(),
    day: null,
    today: zeroCounts(),
    streak: 0,
    statGrowth: { debugging: 0, patience: 0, chaos: 0, wisdom: 0, snark: 0 },
  };
}

/** 进化的等级：蛋 Lv1 起，Lv5 破壳成幼年，Lv15 成年，Lv30 完全体。 */
export const stageLevels: readonly (readonly [Stage, number])[] = [
  ["egg", 1],
  ["baby", 5],
  ["adult", 15],
  ["final", 30],
];
export const maxLevel = 99;

/** 到 level 级累计要多少经验：20 × (level − 1)²。每天正常使用约 150–250 经验：两天破壳，约三周成年，约三个月完全体。 */
export const xpForLevel = (level: number) => 20 * (level - 1) ** 2;

export function levelOf(xp: number): number {
  return Math.min(maxLevel, Math.floor(Math.sqrt(xp / 20)) + 1);
}

export function stageOf(level: number): Stage {
  let stage: Stage = "egg";
  for (const [candidate, from] of stageLevels) if (level >= from) stage = candidate;
  return stage;
}

/** 本地日期 YYYY-MM-DD。 */
export function dayKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface GrowthStep {
  growth: Growth;
  gained: number;
  /** 这次升到的等级；没升级为 null。 */
  levelUp: number | null;
  /** 这次进化到的阶段；没进化为 null。 */
  evolved: Stage | null;
}

function count(growth: Growth, source: XpSource): number {
  const rule = rules[source];
  if (growth.today[source] >= rule.perDay) return 0;
  growth.today[source] += 1;
  growth.totals[source] += 1;
  if (rule.stat !== null && growth.totals[source] % rule.every === 0) growth.statGrowth[rule.stat] += 1;
  return source === "daily" ? dailyXp(growth.streak) : rule.xp;
}

/** 记一次事件（不改原对象）。新的一天第一次有事件时先签到。 */
export function applyEvent(previous: Growth, source: Exclude<XpSource, "daily">, now: Date): GrowthStep {
  const growth: Growth = structuredClone(previous);
  const today = dayKey(now);
  let gained = 0;
  if (growth.day !== today) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    growth.streak = growth.day === dayKey(yesterday) ? growth.streak + 1 : 1;
    growth.day = today;
    growth.today = zeroCounts();
    gained += count(growth, "daily");
  }
  gained += count(growth, source);
  const fromLevel = levelOf(previous.xp);
  growth.xp += gained;
  const toLevel = levelOf(growth.xp);
  const evolved = stageOf(toLevel) !== stageOf(fromLevel) ? stageOf(toLevel) : null;
  return { growth, gained, levelUp: toLevel > fromLevel ? toLevel : null, evolved };
}

/** 出生属性 + 成长，夹在 0–100。 */
export function currentStats(bones: Bones, growth: Growth): Stats {
  const stats = {} as Record<StatName, number>;
  for (const name of statNames) stats[name] = Math.min(100, bones.stats[name] + growth.statGrowth[name]);
  return stats;
}
