// 模型选择对话框的补充参数，全部只读（AGENTS.md "omp 的边界"：~/.omp 只读可以）：
//   实测速度：agent 目录的 agent.db `model_perf`（model-perf.ts，在 SQLite worker 里读，经 deps.readPerf 进来）。
//   压缩设置：`omp config list --json` 的 compaction.*；在项目目录读到的和中性目录不同，就是项目配置改过。
// 智能分和目录速度不在这里：get_available_models 的模型自带 omp 补好的值（ModelOption.intelligence / catalogTps）。
import type { CompactionSettings, ModelInsights, ModelKey, ModelPerf } from "../../shared/ipc.ts";
import { finiteNumber as num, isRecord } from "../../shared/type-guards.ts";
import { valueOf } from "./model-defaults.ts";

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
  /** agent.db 里这些模型的实测速度（model-perf.ts 的 readModelPerf；应用里在 SQLite worker 里跑）。 */
  readPerf(keys: readonly ModelKey[]): Promise<Record<string, ModelPerf>>;
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
  const perf = deps.readPerf(keys).catch((error: unknown): Record<string, ModelPerf> => {
    deps.warn("model insights: cannot read agent.db", error);
    return {};
  });
  return { perf: await perf, compaction: await compaction };
}
