// 本会话按模型的用量：只读 omp 的会话文件（JSONL），把 assistant 消息的 usage 按 provider/model 相加。
// 范围和 get_session_stats 一致（18.12.2 实测逐项相等）：沿 parentId 从最后一条走到根得到当前分支，
// 只算最近一次压缩的 firstKeptEntryId 起的部分；压缩过时另给当前分支全部的合计（压缩前花掉的也是钱）。
// 当前分支取文件最后一条：omp 只在叶子上追加；在会话树里跳到别处但还没发消息时会偏，这时只是数字差一些。
// 规则只有 SessionUsageAccumulator 一份：整段文本（summarizeSessionUsage）和增量读文件（tsp/session-file-reader.ts）都喂给它。
import type { ModelUsage, SessionModelUsage } from "../../shared/ipc.ts";
import type { TokenUsage } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { isRecord } from "../../shared/type-guards.ts";
import {
  feedSessionText,
  readSessionFile,
  type SessionEntryConsumer,
  type SessionFileEntry,
} from "../tsp/session-file-reader.ts";

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** 一条 assistant 消息的用量（requests 记 1）。 */
type UsageRow = Omit<ModelUsage, "requests">;

/** 一条有 id 的记录里算用量要用的部分（不留整条记录）。 */
interface UsageEntry {
  id: string;
  parentId: string | null;
  compaction: boolean;
  firstKeptEntryId: string | null;
  usage: UsageRow | null;
}

function usageOf(entry: SessionFileEntry): UsageRow | null {
  if (entry["type"] !== "message" || !isRecord(entry["message"])) return null;
  const message = entry["message"];
  if (message["role"] !== "assistant" || !isRecord(message["usage"])) return null;
  const usage = message["usage"];
  return {
    provider: str(message["provider"]) ?? "",
    modelId: str(message["model"]) ?? "",
    input: num(usage["input"]),
    output: num(usage["output"]),
    cacheRead: num(usage["cacheRead"]),
    cacheWrite: num(usage["cacheWrite"]),
    total: num(usage["totalTokens"]),
    cost: isRecord(usage["cost"]) ? num(usage["cost"]["total"]) : 0,
  };
}

function sumModels(entries: readonly UsageEntry[]): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const { usage } of entries) {
    if (usage === null) continue;
    const key = `${usage.provider}/${usage.modelId}`;
    let row = models.get(key);
    if (row === undefined) {
      row = { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, requests: 0 };
      models.set(key, row);
    }
    row.input += usage.input;
    row.output += usage.output;
    row.cacheRead += usage.cacheRead;
    row.cacheWrite += usage.cacheWrite;
    row.total += usage.total;
    row.cost += usage.cost;
    row.requests++;
  }
  return [...models.values()].sort((a, b) => b.total - a.total);
}

/** 按文件顺序接收记录，summary() 随时给出到目前为止的按模型用量。 */
export class SessionUsageAccumulator implements SessionEntryConsumer {
  readonly #byId = new Map<string, UsageEntry>();
  /** 最后一条有 id 的记录：当前分支的叶子。 */
  #leaf: UsageEntry | null = null;

  entry(entry: SessionFileEntry): void {
    const id = str(entry["id"]);
    if (id === null) return;
    const compaction = entry["type"] === "compaction";
    const kept: UsageEntry = {
      id,
      parentId: str(entry["parentId"]),
      compaction,
      firstKeptEntryId: compaction ? str(entry["firstKeptEntryId"]) : null,
      usage: usageOf(entry),
    };
    this.#byId.set(id, kept);
    this.#leaf = kept;
  }

  reset(): void {
    this.#byId.clear();
    this.#leaf = null;
  }

  /** 从叶子沿 parentId 走到根，按从根到叶的顺序返回。 */
  #activeBranch(): UsageEntry[] {
    const branch: UsageEntry[] = [];
    const seen = new Set<string>();
    for (let entry = this.#leaf; entry !== null;) {
      if (seen.has(entry.id)) break;
      seen.add(entry.id);
      branch.push(entry);
      entry = entry.parentId === null ? null : (this.#byId.get(entry.parentId) ?? null);
    }
    return branch.reverse();
  }

  summary(): SessionModelUsage {
    const branch = this.#activeBranch();
    let compactions = 0;
    let start = 0;
    branch.forEach((entry, index) => {
      if (!entry.compaction) return;
      compactions++;
      const kept = entry.firstKeptEntryId;
      const keptIndex = kept === null ? -1 : branch.findIndex((candidate) => candidate.id === kept);
      start = keptIndex >= 0 ? keptIndex : index + 1;
    });
    const models = sumModels(branch.slice(start));
    if (compactions === 0) return { models, compactions, whole: null };
    const all = sumModels(branch);
    return {
      models,
      compactions,
      whole: {
        total: all.reduce((sum, row) => sum + row.total, 0),
        cost: all.reduce((sum, row) => sum + row.cost, 0),
      },
    };
  }
}

export function summarizeSessionUsage(text: string): SessionModelUsage {
  const usage = new SessionUsageAccumulator();
  feedSessionText(text, [usage]);
  return usage.summary();
}

/** 各模型合计的 token 分项和请求数：TSP 任务的 `sessionUsage`（omp 的 TSP 输入框卡片只给费用，token 和请求数从会话文件补）。 */
export interface SessionTotals {
  tokens: TokenUsage;
  requests: number;
}

export function totalUsage(models: readonly ModelUsage[]): SessionTotals {
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let requests = 0;
  for (const row of models) {
    tokens.input += row.input;
    tokens.output += row.output;
    tokens.cacheRead += row.cacheRead;
    tokens.cacheWrite += row.cacheWrite;
    tokens.total += row.total;
    requests += row.requests;
  }
  return { tokens, requests };
}

/** 超过 MAX_SESSION_FILE_BYTES 的会话文件抛错、不读（和 readSessionEntries 同一个上限）。新会话的文件在第一条回复之后才落盘：没有文件是空表。 */
export async function readSessionUsage(file: string | null): Promise<SessionModelUsage> {
  const usage = new SessionUsageAccumulator();
  if (file !== null) await readSessionFile(file, [usage]);
  return usage.summary();
}
