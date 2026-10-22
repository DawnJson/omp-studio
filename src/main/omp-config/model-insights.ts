// 模型选择对话框右栏的补充参数，全部只读（AGENTS.md "omp 的边界"：~/.omp 只读可以）：
//   速度：agent 目录的 agent.db `model_perf`（omp 每轮记下的输出 token、生成耗时、首字延迟，键 `provider/modelId`）。
//   智能分：agent 目录的 models.db `model_cache`（provider 的模型目录 JSON，条目的 `int`；没有实测速度时也用条目的 `tps`）。
//   压缩设置：`omp config list --json` 的 compaction.*；在项目目录读到的和中性目录不同，就是项目配置改过。
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CompactionSettings, ModelInsights, ModelKey, ModelPerf } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { valueOf } from "./model-defaults.ts";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const keyOf = (key: ModelKey) => `${key.provider}/${key.modelId}`;

/** 两个库都是 WAL；omp 同时在写时读方短暂等待，不直接 BUSY。 */
function openReadOnly(file: string): DatabaseSync | null {
  return existsSync(file) ? new DatabaseSync(file, { readOnly: true, timeout: 2000 }) : null;
}

interface PerfRow {
  model_key: string;
  samples: number;
  output_tokens: number;
  gen_ms: number;
  ttft_samples: number;
  ttft_ms: number;
}

function readModelPerf(agentDir: string, keys: readonly ModelKey[]): Record<string, ModelPerf> {
  const db = openReadOnly(path.join(agentDir, "agent.db"));
  if (db === null) return {};
  try {
    const wanted = new Set(keys.map(keyOf));
    const rows = db
      .prepare("SELECT model_key, samples, output_tokens, gen_ms, ttft_samples, ttft_ms FROM model_perf")
      .all() as unknown as PerfRow[];
    const perf: Record<string, ModelPerf> = {};
    for (const row of rows) {
      if (!wanted.has(row.model_key) || row.samples <= 0) continue;
      perf[row.model_key] = {
        tokensPerSecond: row.gen_ms > 0 ? (row.output_tokens / row.gen_ms) * 1000 : null,
        ttftMs: row.ttft_samples > 0 ? row.ttft_ms / row.ttft_samples : null,
        samples: Math.round(row.samples),
      };
    }
    return perf;
  } finally {
    db.close();
  }
}

/**
 * models.db 的 provider_id 可能带账号后缀（`github-copilot:models-v2:…`），按 `provider` 或 `provider:` 前缀对上。
 * 只解析请求里出现的 provider 的那几行（整个库有几 MB）。
 */
function readCatalogStats(
  agentDir: string,
  keys: readonly ModelKey[],
): { intelligence: Record<string, number>; tps: Record<string, number> } {
  const intelligence: Record<string, number> = {};
  const tps: Record<string, number> = {};
  const db = openReadOnly(path.join(agentDir, "models.db"));
  if (db === null) return { intelligence, tps };
  try {
    const byProvider = new Map<string, Set<string>>();
    for (const key of keys) byProvider.set(key.provider, (byProvider.get(key.provider) ?? new Set()).add(key.modelId));
    const rows = db.prepare("SELECT provider_id, models FROM model_cache").all() as unknown as {
      provider_id: string;
      models: string;
    }[];
    for (const row of rows) {
      const provider = row.provider_id.split(":")[0] ?? row.provider_id;
      const ids = byProvider.get(provider);
      if (ids === undefined) continue;
      let models: unknown;
      try {
        models = JSON.parse(row.models);
      } catch {
        continue;
      }
      if (!Array.isArray(models)) continue;
      for (const model of models) {
        if (!isRecord(model) || typeof model["id"] !== "string" || !ids.has(model["id"])) continue;
        const key = `${provider}/${model["id"]}`;
        const score = num(model["int"]);
        const speed = num(model["tps"]);
        // 同一个 provider 有多行（多个账号）时取第一个有值的。
        if (score !== null && !(key in intelligence)) intelligence[key] = score;
        if (speed !== null && speed > 0 && !(key in tps)) tps[key] = speed;
      }
    }
    return { intelligence, tps };
  } finally {
    db.close();
  }
}

const compactionKeys = [
  "compaction.thresholdTokens",
  "compaction.thresholdPercent",
  "compaction.reserveTokens",
  "compaction.modelThresholds",
  "compaction.modelThresholdsEnabled",
] as const;

/** `listed` 是在项目目录（没有项目时是中性目录）里读的；`global` 是中性目录里读的，没有项目时为 null。 */
export function compactionSettings(listed: unknown, global: unknown): CompactionSettings {
  const thresholds = valueOf(listed, "compaction.modelThresholds");
  const modelThresholds: Record<string, number | string> = {};
  if (isRecord(thresholds)) {
    for (const [pattern, value] of Object.entries(thresholds)) {
      if (typeof value === "number" || typeof value === "string") modelThresholds[pattern] = value;
    }
  }
  const differs =
    global !== null &&
    compactionKeys.some((key) => JSON.stringify(valueOf(listed, key)) !== JSON.stringify(valueOf(global, key)));
  const reserve = num(valueOf(listed, "compaction.reserveTokens"));
  return {
    thresholdTokens: num(valueOf(listed, "compaction.thresholdTokens")) ?? -1,
    thresholdPercent: num(valueOf(listed, "compaction.thresholdPercent")) ?? -1,
    reserveTokens: reserve !== null && reserve > 0 ? reserve : null,
    modelThresholds,
    modelThresholdsEnabled: valueOf(listed, "compaction.modelThresholdsEnabled") !== false,
    source: differs ? "project" : "global",
  };
}

export interface ModelInsightsDeps {
  agentDir: string;
  /** `omp config list --json`；cwd 为 null 时在中性目录。 */
  list(cwd: string | null): Promise<unknown>;
  warn(message: string, error: unknown): void;
}

export async function readModelInsights(
  deps: ModelInsightsDeps,
  projectPath: string | null,
  keys: readonly ModelKey[],
): Promise<ModelInsights> {
  const compaction = Promise.all([deps.list(projectPath), projectPath === null ? null : deps.list(null)]).then(
    ([listed, global]) => compactionSettings(listed, global),
    (error: unknown) => {
      deps.warn("model insights: cannot read compaction settings", error);
      return null;
    },
  );
  let perf: Record<string, ModelPerf> = {};
  let catalog: ReturnType<typeof readCatalogStats> = { intelligence: {}, tps: {} };
  try {
    perf = readModelPerf(deps.agentDir, keys);
  } catch (error) {
    deps.warn("model insights: cannot read agent.db", error);
  }
  try {
    catalog = readCatalogStats(deps.agentDir, keys);
  } catch (error) {
    deps.warn("model insights: cannot read models.db", error);
  }
  for (const [key, speed] of Object.entries(catalog.tps)) {
    perf[key] ??= { tokensPerSecond: speed, ttftMs: null, samples: 0 };
  }
  return { perf, intelligence: catalog.intelligence, compaction: await compaction };
}
