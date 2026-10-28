// 本会话按模型的用量：只读 omp 的会话文件（JSONL），把 assistant 消息的 usage 按 provider/model 相加。
// 范围和 get_session_stats 一致（18.12.2 实测逐项相等）：沿 parentId 从最后一条走到根得到当前分支，
// 只算最近一次压缩的 firstKeptEntryId 起的部分；压缩过时另给当前分支全部的合计（压缩前花掉的也是钱）。
// 当前分支取文件最后一条：omp 只在叶子上追加；在会话树里跳到别处但还没发消息时会偏，这时只是数字差一些。
// 规则只有 SessionUsageAccumulator 一份：整段文本（summarizeSessionUsage）和增量读文件（tsp/session-files.ts）都喂给它。
// 顺带按 omp 恢复会话的规则记当前分支上的模型（currentModel）：TSP 输入框卡片上只有模型显示名，多家 provider 重名时靠它认出是哪一家。
import type { ModelKey, ModelUsage, SessionModelUsage } from "../../shared/ipc.ts";
import type { TokenUsage } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { finiteOrZero as num, isRecord } from "../../shared/type-guards.ts";
import { feedSessionText, type SessionEntryConsumer, type SessionFileEntry } from "../tsp/session-file-reader.ts";

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
  /** `model_change` 记录切到的模型和它的 role（没写 role 的是 `default`）。 */
  model: { key: ModelKey; role: string } | null;
}

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

/** 按文件顺序接收记录，summary() 随时给出到目前为止的按模型用量，currentModel() 给当前分支上 omp 会选的模型。 */
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
      model: modelChangeOf(entry),
    };
    this.#byId.set(id, kept);
    this.#leaf = kept;
  }

  reset(): void {
    this.#byId.clear();
    this.#leaf = null;
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
    for (let entry = this.#leaf; entry !== null;) {
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
