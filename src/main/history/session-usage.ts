// 本会话按模型的用量：只读 omp 的会话文件（JSONL），把 assistant 消息的 usage 按 provider/model 相加。
// 范围和 get_session_stats 一致（18.12.2 实测逐项相等）：沿 parentId 从最后一条走到根得到当前分支，
// 只算最近一次压缩的 firstKeptEntryId 起的部分；压缩过时另给当前分支全部的合计（压缩前花掉的也是钱）。
// 当前分支取文件最后一条：omp 只在叶子上追加；在会话树里跳到别处但还没发消息时会偏，这时只是数字差一些。
import { readFile } from "node:fs/promises";
import type { ModelUsage, SessionModelUsage } from "../../shared/ipc.ts";
import type { TokenUsage } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { isRecord } from "../../shared/type-guards.ts";

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

type Entry = Record<string, unknown>;

function parseEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) entries.push(value);
    } catch {
      // 写到一半的最后一行（omp 正在追加）或损坏的行：跳过。
    }
  }
  return entries;
}

/** 从最后一条有 id 的记录沿 parentId 走到根，按从根到叶的顺序返回。 */
function activeBranch(entries: readonly Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  let leaf: Entry | null = null;
  for (const entry of entries) {
    const id = str(entry["id"]);
    if (id === null) continue;
    byId.set(id, entry);
    leaf = entry;
  }
  const branch: Entry[] = [];
  const seen = new Set<string>();
  for (let entry = leaf; entry !== null;) {
    const id = str(entry["id"]);
    if (id === null || seen.has(id)) break;
    seen.add(id);
    branch.push(entry);
    const parent = str(entry["parentId"]);
    entry = parent === null ? null : (byId.get(parent) ?? null);
  }
  return branch.reverse();
}

function addUsage(models: Map<string, ModelUsage>, entry: Entry): void {
  if (entry["type"] !== "message" || !isRecord(entry["message"])) return;
  const message = entry["message"];
  if (message["role"] !== "assistant" || !isRecord(message["usage"])) return;
  const usage = message["usage"];
  const provider = str(message["provider"]) ?? "";
  const modelId = str(message["model"]) ?? "";
  const key = `${provider}/${modelId}`;
  let row = models.get(key);
  if (row === undefined) {
    row = { provider, modelId, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, requests: 0 };
    models.set(key, row);
  }
  row.input += num(usage["input"]);
  row.output += num(usage["output"]);
  row.cacheRead += num(usage["cacheRead"]);
  row.cacheWrite += num(usage["cacheWrite"]);
  row.total += num(usage["totalTokens"]);
  row.cost += isRecord(usage["cost"]) ? num(usage["cost"]["total"]) : 0;
  row.requests++;
}

function sumModels(entries: readonly Entry[]): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const entry of entries) addUsage(models, entry);
  return [...models.values()].sort((a, b) => b.total - a.total);
}

export function summarizeSessionUsage(text: string): SessionModelUsage {
  const branch = activeBranch(parseEntries(text));
  let compactions = 0;
  let start = 0;
  branch.forEach((entry, index) => {
    if (entry["type"] !== "compaction") return;
    compactions++;
    const kept = str(entry["firstKeptEntryId"]);
    const keptIndex = kept === null ? -1 : branch.findIndex((candidate) => candidate["id"] === kept);
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

export async function readSessionUsage(file: string | null): Promise<SessionModelUsage> {
  if (file === null) return { models: [], compactions: 0, whole: null };
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    // 新会话的文件在第一条回复之后才落盘。
    if (isRecord(error) && error["code"] === "ENOENT") return "";
    throw error;
  });
  return summarizeSessionUsage(text);
}
