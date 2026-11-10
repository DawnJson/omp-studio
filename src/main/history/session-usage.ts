// 本会话按模型的用量：只读 omp 的会话文件（JSONL），把 assistant 消息和 `model_usage` 记录的 usage 按 provider/model 相加。
// `model_usage` 是不进对话的模型调用（后台作业 job-*、task-completion-*、标题、缓存预热 cache-warm 等），
// 带 cacheRefresh 的也算；一条记一个请求（omp stats.db 也是一条一行）。
// 范围照 omp 18.18.5 get_session_stats（session-stats.ts 的 forEachActiveModelUsage；18.18.5 用会话副本实测逐项相等，
// 见 docs/architecture/session-history.md "范围的规则"）：
// 从叶子沿 parentId 走到根得到当前分支，只算窗口内的：最近一次压缩之后有 /clear（reset_boundary）就从它之后起，
// 否则从最近一次压缩的 firstKeptEntryId 起（找不到就从压缩之后起），再往前带上紧挨着的非消息记录（如 model_usage）；
// 压缩过时另给当前分支全部的合计（压缩前花掉的也是钱）。不在当前分支上的 model_usage（迟到的用量挂在发起时的位置）不算。
// 叶子照 omp 回放（session-entries.ts 的 resolveSessionLeafId）：文件最后一条带 activeLeafId 时取它（null 为没有叶子，
// 指向的记录不在时取最后一条不带 activeLeafId 的），否则取最后一条本身。
// 规则只有 SessionUsageAccumulator 一份：整段文本（summarizeSessionUsage）和增量读文件（tsp/session-files.ts）都喂给它。
// 顺带按 omp 恢复会话的规则记当前分支上的模型（currentModel）：TSP 输入框卡片上只有模型显示名，多家 provider 重名时靠它认出是哪一家。
import type { ModelKey, ModelUsage, SessionModelUsage } from "../../shared/ipc.ts";
import type { TokenUsage } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { finiteOrZero as num, isRecord } from "../../shared/type-guards.ts";
import { feedSessionText, type SessionEntryConsumer, type SessionFileEntry } from "../tsp/session-file-reader.ts";

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** 一条 assistant 消息或 `model_usage` 记录的用量（requests 记 1）。 */
type UsageRow = Omit<ModelUsage, "requests">;

/** 一条有 id 的记录里算用量要用的部分（不留整条记录）。 */
interface UsageEntry {
  id: string;
  parentId: string | null;
  compaction: boolean;
  firstKeptEntryId: string | null;
  /** `/clear` 留下的 `reset_boundary`。 */
  reset: boolean;
  /** omp 的 isUsageWindowBoundary：压缩窗口往前带非消息记录时停在这些记录上。 */
  boundary: boolean;
  usage: UsageRow | null;
  /** `model_change` 记录切到的模型和它的 role（没写 role 的是 `default`）。 */
  model: { key: ModelKey; role: string } | null;
}

const WINDOW_BOUNDARY_TYPES: Record<string, true> = {
  message: true,
  custom_message: true,
  branch_summary: true,
  compaction: true,
  reset_boundary: true,
};

/** omp 会话文件里的模型写法 `provider/id`（id 里可以再有 `/`，如 `huggingface/moonshotai/Kimi-K3`）。 */
function modelKeyOf(value: unknown): ModelKey | null {
  const text = str(value);
  const slash = text?.indexOf("/") ?? -1;
  if (text === null || slash <= 0 || slash === text.length - 1) return null;
  return { provider: text.slice(0, slash), modelId: text.slice(slash + 1) };
}

function modelChangeOf(entry: SessionFileEntry): UsageEntry["model"] {
  if (entry["type"] !== "model_change") return null;
  const key = modelKeyOf(entry["model"]);
  return key === null ? null : { key, role: str(entry["role"]) ?? "default" };
}

function usageOf(entry: SessionFileEntry): UsageRow | null {
  let source: Record<string, unknown>;
  if (entry["type"] === "model_usage") {
    source = entry;
  } else if (entry["type"] === "message" && isRecord(entry["message"]) && entry["message"]["role"] === "assistant") {
    source = entry["message"];
  } else {
    return null;
  }
  const usage = source["usage"];
  if (!isRecord(usage)) return null;
  return {
    provider: str(source["provider"]) ?? "",
    modelId: str(source["model"]) ?? "",
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

/** 按文件顺序接收记录，summary() 随时给出到目前为止的按模型用量，currentModel() 给当前分支上 omp 会选的模型。 */
export class SessionUsageAccumulator implements SessionEntryConsumer {
  readonly #byId = new Map<string, UsageEntry>();
  /** 回放到最后一条时的叶子 id（最后一条的 activeLeafId，没有就是它自己）；null 为没有叶子。 */
  #leafId: string | null = null;
  /** 最后一条不带 activeLeafId 的记录：叶子指向的记录不在时退回它。 */
  #lastSelf: UsageEntry | null = null;

  entry(entry: SessionFileEntry): void {
    const id = str(entry["id"]);
    if (id === null) return;
    const type = entry["type"];
    const compaction = type === "compaction";
    const kept: UsageEntry = {
      id,
      parentId: str(entry["parentId"]),
      compaction,
      firstKeptEntryId: compaction ? str(entry["firstKeptEntryId"]) : null,
      reset: type === "reset_boundary",
      boundary: typeof type === "string" && Object.hasOwn(WINDOW_BOUNDARY_TYPES, type),
      usage: usageOf(entry),
      model: modelChangeOf(entry),
    };
    this.#byId.set(id, kept);
    const activeLeafId = entry["activeLeafId"];
    if (activeLeafId === undefined) {
      this.#leafId = id;
      this.#lastSelf = kept;
    } else {
      this.#leafId = str(activeLeafId);
    }
  }

  reset(): void {
    this.#byId.clear();
    this.#leafId = null;
    this.#lastSelf = null;
  }

  /**
   * 当前分支上 omp 会选的模型，规则照 omp 恢复会话（omp 18.13.1 `session-context.ts` 的 `zae` / `restoreSessionModel`）：
   * 每个 role 取分支上最后一条 `model_change`；最后一条的 role 是 `default` / `fallback`（重试时临时换的）就用 `default` 的，
   * 否则（如会话内临时切换 `temporary`）用那个 role 的。没有 `model_change` 为 null。
   */
  currentModel(): ModelKey | null {
    const byRole = new Map<string, ModelKey>();
    let lastRole: string | null = null;
    for (const { model } of this.#activeBranch()) {
      if (model === null) continue;
      byRole.set(model.role, model.key);
      lastRole = model.role;
    }
    const role = lastRole === null || lastRole === "fallback" ? "default" : lastRole;
    return byRole.get(role) ?? byRole.get("default") ?? null;
  }

  /** 从叶子沿 parentId 走到根，按从根到叶的顺序返回。 */
  #activeBranch(): UsageEntry[] {
    const branch: UsageEntry[] = [];
    const seen = new Set<string>();
    const leaf = this.#leafId === null ? null : (this.#byId.get(this.#leafId) ?? this.#lastSelf);
    for (let entry = leaf; entry !== null;) {
      if (seen.has(entry.id)) break;
      seen.add(entry.id);
      branch.push(entry);
      entry = entry.parentId === null ? null : (this.#byId.get(entry.parentId) ?? null);
    }
    return branch.toReversed();
  }

  summary(): SessionModelUsage {
    const branch = this.#activeBranch();
    let compactions = 0;
    let compactionIndex = -1;
    branch.forEach((entry, index) => {
      if (!entry.compaction) return;
      compactions++;
      compactionIndex = index;
    });
    const resetIndex = branch.findLastIndex((entry) => entry.reset);
    let start = 0;
    if (resetIndex > compactionIndex) {
      start = resetIndex + 1;
    } else if (compactionIndex >= 0) {
      const kept = branch[compactionIndex]?.firstKeptEntryId ?? null;
      const keptIndex = kept === null ? -1 : branch.findIndex((candidate) => candidate.id === kept);
      start = keptIndex >= 0 ? keptIndex : compactionIndex + 1;
      while (start > 0 && branch[start - 1]?.boundary === false) start--;
    }
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
