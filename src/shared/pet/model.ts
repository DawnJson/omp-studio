// 桌面宠物的数据模型（docs/architecture/pet.md）。主进程、宠物窗口共用，不 import electron。
// 骨（bones.ts）：物种、稀有度、眼睛、帽子、闪光、出生属性，按本机种子现算、不存盘。
// 魂：名字和性格，孵化时让 omp 的 smol 角色写一次，存 userData/pet.json。
// 成长（growth.ts）：经验、等级、阶段、属性成长，存 userData/pet.json。
import type { Species, Stage } from "./sprites.ts";

export type { Species, Stage } from "./sprites.ts";

export const rarities = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof rarities)[number];

/** 稀有度：抽中概率（权重，合计 100）、星数、出生属性的下限。照 Claude Code 的 buddy。 */
export const rarityInfo: Readonly<Record<Rarity, { weight: number; stars: number; floor: number }>> = {
  common: { weight: 60, stars: 1, floor: 5 },
  uncommon: { weight: 25, stars: 2, floor: 15 },
  rare: { weight: 10, stars: 3, floor: 25 },
  epic: { weight: 4, stars: 4, floor: 35 },
  legendary: { weight: 1, stars: 5, floor: 50 },
};

export const hats = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"] as const;
export type Hat = (typeof hats)[number];

/** 每顶帽子至少要什么稀有度；普通（common）没有帽子。 */
export const hatMinRarity: Readonly<Record<Exclude<Hat, "none">, Rarity>> = {
  crown: "uncommon",
  tophat: "uncommon",
  propeller: "uncommon",
  halo: "rare",
  wizard: "rare",
  beanie: "epic",
  tinyduck: "legendary",
};

export const eyeStyles = ["dot", "tall", "sleepy", "spark"] as const;
export type EyeStyle = (typeof eyeStyles)[number];

export const statNames = ["debugging", "patience", "chaos", "wisdom", "snark"] as const;
export type StatName = (typeof statNames)[number];
export type Stats = Readonly<Record<StatName, number>>;

export interface Bones {
  species: Species;
  rarity: Rarity;
  eye: EyeStyle;
  hat: Hat;
  shiny: boolean;
  /** 出生属性（0–100）。 */
  stats: Stats;
}

export interface Soul {
  name: string;
  personality: string;
  /** 孵化时间（毫秒）。 */
  hatchedAt: number;
}

/**
 * 宠物此刻的样子：所有任务汇总出来的状态（mood.ts）。
 * done = 刚有任务跑完一轮（主进程只保持几秒）；其余是持续状态。
 */
export const moods = ["idle", "running", "waiting", "error", "done"] as const;
export type Mood = (typeof moods)[number];

/** 宠物窗口画一次需要的全部数据（主进程算好推过来）。 */
export interface PetView {
  bones: Bones;
  stage: Stage;
  level: number;
  /** 本级已得 / 升到下一级共需的经验。 */
  levelXp: number;
  levelXpNeeded: number;
  /** 出生属性 + 成长，夹在 0–100。 */
  stats: Stats;
  /** 每项属性的成长量（属性卡上单独显示）。 */
  growth: Stats;
  /** 还没孵化好（smol 还没写出名字）时为 null。 */
  soul: Soul | null;
  mood: Mood;
  /** 说话（气泡）开着。 */
  talk: boolean;
  locale: "zh-CN" | "en";
  /** html 的 data-theme（null = 跟随系统）。 */
  theme: string | null;
  reduceMotion: boolean;
}

/** 主进程推给宠物窗口的一次性动作。 */
export type PetReaction =
  | { kind: "say"; text: string }
  | { kind: "hearts" }
  | { kind: "levelUp"; level: number }
  | { kind: "evolve"; stage: Stage }
  | { kind: "card" };

export const PET_NAME_MAX_CHARS = 24;

/** 宠物调模型（起名、说话）花掉的量：调用次数、token（omp usage 的 totalTokens）、美元（usage.cost.total）。 */
export interface VoiceSpend {
  calls: number;
  tokens: number;
  cost: number;
}

/** 设置页显示的花费：今天（本地日期）和累计。重新孵化不清零（花的是这台机器的钱，不属于某一只）。 */
export interface PetSpend {
  today: VoiceSpend;
  total: VoiceSpend;
}
