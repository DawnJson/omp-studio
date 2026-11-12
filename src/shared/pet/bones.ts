// 宠物的"骨"：从本机种子确定性地抽出物种、稀有度、眼睛、帽子、闪光和出生属性（照 Claude Code 的 buddy）。
// 种子 + 盐 → FNV-1a（32 位）→ Mulberry32 伪随机数，按固定顺序抽：稀有度 → 物种 → 眼睛 → 帽子 → 闪光 → 属性。
// 每次启动现算、不存盘：同一个种子永远是同一只。换盐等于给所有人换一只（"换季"），重新孵化 = 换种子。
import {
  eyeStyles,
  hatMinRarity,
  hats,
  rarities,
  rarityInfo,
  statNames,
  type Bones,
  type Hat,
  type Rarity,
  type Species,
  type StatName,
} from "./model.ts";
import { speciesList } from "./sprites.ts";

const SALT = "omp-studio-pet-2026";

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32：32 位种子的小型伪随机数发生器，返回 [0, 1)。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(random: () => number, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const int = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1));

function rollHat(random: () => number, rarity: Rarity): Hat {
  if (rarity === "common") return "none";
  const allowed = hats.filter(
    (hat) => hat !== "none" && rarities.indexOf(hatMinRarity[hat]) <= rarities.indexOf(rarity),
  );
  return pick(random, allowed);
}

/** 一项拉满（下限 + 50 + 随机），一项垫底（贴着下限），其余三项散开。稀有度越高下限越高。 */
function rollStats(random: () => number, rarity: Rarity): Record<StatName, number> {
  const { floor } = rarityInfo[rarity];
  const peak = pick(random, statNames);
  const dump = pick(
    random,
    statNames.filter((name) => name !== peak),
  );
  const stats = {} as Record<StatName, number>;
  for (const name of statNames) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + int(random, 0, 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 4 + int(random, 0, 8));
    else stats[name] = Math.min(100, floor + int(random, 0, 40));
  }
  return stats;
}

export function rollBones(seed: string): Bones {
  const random = mulberry32(fnv1a(`${SALT}:${seed}`));
  const rarity = weighted(random, rarities, (item) => rarityInfo[item].weight);
  // π 是 studio 自己的吉祥物，稀有一些（约 5%），其余物种均分。
  const species = weighted(random, speciesList, (item: Species) => (item === "pi" ? 1 : 3));
  const eye = pick(random, eyeStyles);
  const hat = rollHat(random, rarity);
  const shiny = random() < 0.01;
  return { species, rarity, eye, hat, shiny, stats: rollStats(random, rarity) };
}
