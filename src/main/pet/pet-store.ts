// userData/pet.json：宠物的种子、魂（名字、性格）、成长和窗口位置（docs/architecture/pet.md「存储」）。
// 骨不存（每次从种子现算）。经验写得勤，所以不放进 settings.json；只有主进程写，串行原子写，退出前等它写完。
// 文件坏了逐字段回落：种子坏了换一个新的（等于重新孵化），成长坏了从头来，都不让应用起不来。
import { randomUUID } from "node:crypto";
import { PET_NAME_MAX_CHARS, statNames, type PetSpend, type Soul, type VoiceSpend } from "../../shared/pet/model.ts";
import { ACHIEVED_KEEP, emptyGrowth, xpSources, type Growth } from "../../shared/pet/growth.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { log } from "../log/log.ts";
import { readJsonFile } from "../settings/json-file.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";

export const PET_PERSONALITY_MAX_CHARS = 400;

export interface PetPosition {
  x: number;
  y: number;
}

/** 调模型的花费：day 是 today 记的那一天（本地日期）；跨天后第一次记账时 today 清零。 */
export interface StoredSpend {
  day: string | null;
  today: VoiceSpend;
  total: VoiceSpend;
}

export interface PetRecord {
  seed: string;
  soul: Soul | null;
  growth: Growth;
  /** 窗口左上角（屏幕坐标，DIP）；还没摆过为 null（放到主屏右下角）。 */
  position: PetPosition | null;
  spend: StoredSpend;
}

const seedPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

const zeroSpend = (): VoiceSpend => ({ calls: 0, tokens: 0, cost: 0 });

export const emptySpend = (): StoredSpend => ({ day: null, today: zeroSpend(), total: zeroSpend() });

function parseVoiceSpend(value: unknown): VoiceSpend {
  if (!isRecord(value)) return zeroSpend();
  const cost = value["cost"];
  return {
    calls: count(value["calls"]),
    tokens: count(value["tokens"]),
    cost: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : 0,
  };
}

function parseSpend(value: unknown): StoredSpend {
  if (!isRecord(value)) return emptySpend();
  const day = value["day"];
  return {
    day: typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    today: parseVoiceSpend(value["today"]),
    total: parseVoiceSpend(value["total"]),
  };
}

const plus = (a: VoiceSpend, b: VoiceSpend): VoiceSpend => ({
  calls: a.calls + b.calls,
  tokens: a.tokens + b.tokens,
  cost: a.cost + b.cost,
});

/** 记一次调用的花费；day 和上次记账不是同一天时 today 从零开始。 */
export function addSpend(stored: StoredSpend, spend: VoiceSpend, day: string): StoredSpend {
  const today = stored.day === day ? stored.today : zeroSpend();
  return { day, today: plus(today, spend), total: plus(stored.total, spend) };
}

/** 给设置页看的：今天还没记过账（day 是以前的日子）时今天为零。 */
export function spendOn(stored: StoredSpend, day: string): PetSpend {
  return { today: stored.day === day ? stored.today : zeroSpend(), total: stored.total };
}

function parseSoul(value: unknown): Soul | null {
  if (!isRecord(value)) return null;
  const { name, personality, hatchedAt } = value;
  if (typeof name !== "string" || name.trim() === "" || name.length > PET_NAME_MAX_CHARS) return null;
  if (typeof personality !== "string" || personality.length > PET_PERSONALITY_MAX_CHARS) return null;
  if (typeof hatchedAt !== "number" || !Number.isFinite(hatchedAt)) return null;
  return { name, personality, hatchedAt };
}

function parseGrowth(value: unknown): Growth {
  const growth = emptyGrowth();
  if (!isRecord(value)) return growth;
  growth.xp = count(value["xp"]);
  growth.streak = count(value["streak"]);
  growth.day = typeof value["day"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value["day"]) ? value["day"] : null;
  const totals = isRecord(value["totals"]) ? value["totals"] : {};
  const today = isRecord(value["today"]) ? value["today"] : {};
  for (const source of xpSources) {
    growth.totals[source] = count(totals[source]);
    growth.today[source] = count(today[source]);
  }
  const stats = isRecord(value["statGrowth"]) ? value["statGrowth"] : {};
  for (const name of statNames) growth.statGrowth[name] = count(stats[name]);
  const achieved = value["achieved"];
  if (Array.isArray(achieved))
    growth.achieved = achieved
      .filter((key): key is string => typeof key === "string" && key !== "" && key.length <= 500)
      .slice(-ACHIEVED_KEEP);
  return growth;
}

function parsePosition(value: unknown): PetPosition | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    ? { x: Math.round(x), y: Math.round(y) }
    : null;
}

/** 逐字段校验 pet.json；没有文件或种子坏了 = 新孵化一只（花费照留）。 */
export function parsePetRecord(raw: unknown): PetRecord {
  const record = isRecord(raw) ? raw : {};
  const seed = record["seed"];
  const position = parsePosition(record["position"]);
  const spend = parseSpend(record["spend"]);
  if (typeof seed !== "string" || !seedPattern.test(seed))
    return { seed: randomUUID(), soul: null, growth: emptyGrowth(), position, spend };
  return { seed, soul: parseSoul(record["soul"]), growth: parseGrowth(record["growth"]), position, spend };
}

/** 重新孵化：新种子，魂和成长清空，位置和花费留着。 */
export function rehatched(record: PetRecord): PetRecord {
  return { ...record, seed: randomUUID(), soul: null, growth: emptyGrowth() };
}

export class PetStore {
  readonly file: string;
  #record: PetRecord;
  #saving: Promise<void> = Promise.resolve();
  #queued = false;

  constructor(file: string) {
    this.file = file;
    this.#record = parsePetRecord(readJsonFile(file));
  }

  get(): PetRecord {
    return this.#record;
  }

  /** 改内存里的记录，写盘排进串行链（排着队的那次还没开始时不再多排一次，写的是轮到时的最新值）。 */
  update(patch: Partial<PetRecord>): PetRecord {
    this.#record = { ...this.#record, ...patch };
    if (!this.#queued) {
      this.#queued = true;
      this.#saving = this.#saving
        .then(() => {
          this.#queued = false;
          return writeFileAtomic(this.file, JSON.stringify(this.#record, null, 2), String(process.pid));
        })
        .catch((error: unknown) => log.error("saving pet.json failed", error));
    }
    return this.#record;
  }

  /** 等写盘做完（退出 hook、测试）。 */
  flush(): Promise<void> {
    return this.#saving;
  }
}
