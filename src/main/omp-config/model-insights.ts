// 模型选择对话框的补充参数，全部只读（AGENTS.md "omp 的边界"：~/.omp 只读可以）：
//   实测速度：agent 目录的 agent.db `model_perf`（omp 每轮记下的输出 token、生成耗时、首字延迟，键 `provider/modelId`）。
//   压缩设置：`omp config list --json` 的 compaction.*；在项目目录读到的和中性目录不同，就是项目配置改过。
// 智能分和目录速度不在这里：get_available_models 的模型自带 omp 补好的值（ModelOption.intelligence / catalogTps）。
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CompactionSettings, ModelInsights, ModelKey, ModelPerf } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { valueOf } from "./model-defaults.ts";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const keyOf = (key: ModelKey) => `${key.provider}/${key.modelId}`;

/** 库是 WAL；omp 同时在写时读方短暂等待，不直接 BUSY。 */
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
  try {
    perf = readModelPerf(deps.agentDir, keys);
  } catch (error) {
    deps.warn("model insights: cannot read agent.db", error);
  }
  return { perf, compaction: await compaction };
}
