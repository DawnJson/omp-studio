// 桌面宠物的数据模型（docs/architecture/pet.md）。主进程、宠物窗口共用，不 import electron。
// 骨（bones.ts）：稀有度、帽子、闪光、出生属性，按本机种子现算、不存盘；物种第一次抽出来后存进 pet.json（物种表变了也不换）。
// 魂：名字和性格，孵化时让 omp 的 smol 角色写一次，存 userData/pet.json。
// 成长（growth.ts）：经验、等级、阶段、分支、属性成长，存 userData/pet.json。

/** 物种（顺序就是图鉴顺序）。π 是 studio 的吉祥物，抽中概率低一些（bones.ts）。 */
export const speciesList = [
  "pi",
  "duck",
  "cat",
  "owl",
  "ghost",
  "robot",
  "axolotl",
  "fox",
  "sprout",
  "moth",
  "penguin",
  "hamster",
  "turtle",
  "mushroom",
  "capybara",
  "drake",
] as const;
export type Species = (typeof speciesList)[number];

/** 属性（元素）：决定冒什么粒子、气场什么颜色（renderer/src/pet/elements.ts）。 */
export type Element =
  | "psychic"
  | "water"
  | "dark"
  | "ghost"
  | "steel"
  | "fairy"
  | "fire"
  | "grass"
  | "bug"
  | "ice"
  | "electric"
  | "rock"
  | "poison"
  | "normal"
  | "dragon";

export const speciesElement: Readonly<Record<Species, Element>> = {
  pi: "psychic",
  duck: "water",
  cat: "dark",
  owl: "psychic",
  ghost: "ghost",
  robot: "steel",
  axolotl: "fairy",
  fox: "fire",
  sprout: "grass",
  moth: "bug",
  penguin: "ice",
  hamster: "electric",
  turtle: "rock",
  mushroom: "poison",
  capybara: "normal",
  drake: "dragon",
};

/** 成长阶段；觉醒是完全体之后再变一次（growth.ts 的 stageLevels）。 */
export const stages = ["egg", "baby", "child", "teen", "adult", "final", "awakened"] as const;
export type Stage = (typeof stages)[number];

/** 成年时按当时最高的属性分路线：稳健（调试 / 耐心 / 智慧）、捣蛋（混乱 / 毒舌）。之后不再变。 */
export const branches = ["steady", "mischief"] as const;
export type Branch = (typeof branches)[number];

/** 从成年起两条路线的形态不同。 */
export const branchedStages: ReadonlySet<Stage> = new Set(["adult", "final", "awakened"]);

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

export const statNames = ["debugging", "patience", "chaos", "wisdom", "snark"] as const;
export type StatName = (typeof statNames)[number];
export type Stats = Readonly<Record<StatName, number>>;

export interface Bones {
  species: Species;
  rarity: Rarity;
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
 * done = 刚有任务跑完一轮（主进程只保持几秒）；sleeping = 很久没有任务动静（主进程按时间切）；其余是持续状态。
 */
const moods = ["idle", "running", "waiting", "error", "done", "sleeping"] as const;
export type Mood = (typeof moods)[number];

/** 宠物窗口画一次需要的全部数据（主进程算好推过来）。 */
export interface PetView {
  bones: Bones;
  stage: Stage;
  /** 成年起的路线；还没到成年为 null。 */
  branch: Branch | null;
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
  /** 陪伴天数（有动静的天数）和连续签到天数，属性卡上显示。 */
  days: number;
  streak: number;
  mood: Mood;
  /** 说话（气泡）开着。 */
  talk: boolean;
  locale: "zh-CN" | "en";
  /** html 的 data-theme（null = 跟随系统）。 */
  theme: string | null;
  reduceMotion: boolean;
}

/**
 * 宠物在自己窗口里的位置（左上角，CSS 像素）。窗口整个留在屏幕工作区里，宠物靠屏幕边时偏到窗口一侧；
 * below = 气泡、属性卡放在宠物下方（宠物贴近屏幕上边，上方放不下）。
 */
export interface PetLayout {
  x: number;
  y: number;
  below: boolean;
}

/** 光标相对宠物的方向，各是 -1 / 0 / 1（右、下为正）：眼睛朝那边看。 */
export interface PetGaze {
  x: number;
  y: number;
}

/** 主进程推给宠物窗口的一次性动作。 */
export type PetReaction =
  | { kind: "say"; text: string }
  | { kind: "hearts" }
  /** 成就（待办阶段做完、目标完成、开了 PR）：撒一阵彩纸。 */
  | { kind: "celebrate" }
  | { kind: "levelUp"; level: number }
  | { kind: "evolve"; stage: Stage }
  | { kind: "card" }
  /** 右键"重新孵化…"：在宠物窗口里弹确认框（studio 样式，不用系统对话框）。 */
  | { kind: "confirmRehatch" };

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
