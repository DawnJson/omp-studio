// 模型的实测速度：agent 目录的 agent.db `model_perf`（omp 每轮记下的输出 token、生成耗时、首字延迟，键 `provider/modelId`），只读。
// 在 SQLite worker 里跑（usage/db-worker.ts），不阻塞主进程；这里不 import electron、不碰主进程状态。
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModelKey, ModelPerf } from "../../shared/ipc.ts";

interface PerfRow {
  model_key: string;
  samples: number;
  output_tokens: number;
  gen_ms: number;
  ttft_samples: number;
  ttft_ms: number;
}

/** 请求的、有采样的模型的实测速度，键 `provider/modelId`；库不存在时为空。 */
export function readModelPerf(agentDir: string, keys: readonly ModelKey[]): Record<string, ModelPerf> {
  const file = path.join(agentDir, "agent.db");
  if (!existsSync(file)) return {};
  // 库是 WAL；omp 同时在写时读方短暂等待，不直接 BUSY。
  const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 });
  try {
    const wanted = new Set(keys.map((key) => `${key.provider}/${key.modelId}`));
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
