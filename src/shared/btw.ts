// `/btw` 旁路提问的数据和纯逻辑（docs/architecture/conversation.md「旁路提问」）。
// 主进程（TspBtw）和渲染进程的 store 各持一份记录列表，都用 applyBtwEvent 推进：同一条规则，投影不会和权威状态分叉。
// 记录就是 omp 的 BtwHistoryRecord（一个话题 = 第一问 + 追问），列表按创建时间从新到旧，和 get_btw_history 一致。
import type { BtwHistoryRecord, BtwHistoryTurn } from "./omp-wire/rpc-wire.generated.ts";

export type { BtwHistoryRecord, BtwHistoryTurn } from "./omp-wire/rpc-wire.generated.ts";

export const btwLimits = {
  /** 一次提问的最大字符数（渲染进程传来的，主进程校验）。 */
  questionChars: 8_192,
  /** 每个任务镜像里保留的话题数；omp 的历史更长时只留最新的。 */
  records: 50,
} as const;

/** 主进程 → 渲染进程：旁路提问的变化。delta 只在记录之后到达（omp 先发 running 的 btw_record 再发 btw_delta）。 */
export type BtwUiEvent =
  | { type: "records"; records: BtwHistoryRecord[] }
  | { type: "record"; record: BtwHistoryRecord }
  | { type: "delta"; recordId: string; delta: string };

/** 话题的最新一问：有追问时是最后一条追问，否则是话题本身。 */
export function latestTurn(record: BtwHistoryRecord): BtwHistoryTurn {
  return record.followUps?.at(-1) ?? record;
}

/** 话题里的所有问答，按提问顺序。 */
export function btwTurns(record: BtwHistoryRecord): BtwHistoryTurn[] {
  return [record, ...(record.followUps ?? [])];
}

/** omp 同一时刻只许一条旁路提问在跑（实测：再问会被拒绝，追问也一样）。 */
export function isBtwRunning(records: readonly BtwHistoryRecord[]): boolean {
  return records.some((record) => latestTurn(record).status === "running");
}

function capRecords(records: BtwHistoryRecord[]): BtwHistoryRecord[] {
  return records.length > btwLimits.records ? records.slice(0, btwLimits.records) : records;
}

function withLatestTurn(record: BtwHistoryRecord, patch: Partial<BtwHistoryTurn>): BtwHistoryRecord {
  const followUps = record.followUps;
  if (followUps && followUps.length > 0) {
    const last = followUps.length - 1;
    return { ...record, followUps: followUps.map((turn, index) => (index === last ? { ...turn, ...patch } : turn)) };
  }
  return { ...record, ...patch };
}

/** 返回新列表；没有变化时返回原数组。 */
export function applyBtwEvent(records: readonly BtwHistoryRecord[], event: BtwUiEvent): readonly BtwHistoryRecord[] {
  switch (event.type) {
    case "records":
      return capRecords([...event.records]);
    case "record": {
      const index = records.findIndex((record) => record.id === event.record.id);
      if (index === -1) return capRecords([event.record, ...records]);
      return records.map((record, i) => (i === index ? event.record : record));
    }
    case "delta": {
      if (event.delta === "") return records;
      const index = records.findIndex((record) => record.id === event.recordId);
      if (index === -1) return records;
      return records.map((record, i) =>
        i === index ? withLatestTurn(record, { answer: latestTurn(record).answer + event.delta }) : record,
      );
    }
  }
}

/** omp 进程退出时还在跑的提问：标成 interrupted（omp 重新读历史时也这么标）。 */
export function interruptBtw(records: readonly BtwHistoryRecord[], at: number): readonly BtwHistoryRecord[] {
  if (!isBtwRunning(records)) return records;
  return records.map((record) =>
    latestTurn(record).status === "running" ? withLatestTurn(record, { status: "interrupted", updatedAt: at }) : record,
  );
}
