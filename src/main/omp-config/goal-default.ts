// 启动时的“目标自动推进”默认允许：`goal.continuationModes` 用户没明确设置过，就经 `omp config set` 加上 "rpc"。
// 不 import electron，单元测试可以直接用。
//
// 怎么分辨“明确设置过”：`omp config list --json` 里明确设成默认值和没设过的输出完全一样（实测，omp 18.12.2），
// 区分不了；但 `omp config set` 一定会把这个键写进 agent 目录的 config.yml（即使值等于默认值），所以只读 config.yml：
// 里面有这个键就是用户（在 omp-studio 或终端里）明确设过，不碰。读 config.yml 只读，不写（docs/architecture/omp-boundaries.md「`~/.omp`」）。
import { goalContinuationKey, goalDefaultWrite } from "../../shared/ui/goal-continuation.ts";
import { isConfigKeyExplicit } from "./startup-defaults.ts";

/** config.yml 里是否有 `goal.continuationModes`（判断规则见 isConfigKeyExplicit）。 */
export function isGoalContinuationExplicit(agentDir: string): Promise<boolean> {
  return isConfigKeyExplicit(agentDir, goalContinuationKey);
}

export interface GoalDefaultDeps {
  /** omp 当前生效的 `goal.continuationModes`（`omp config list --json` 里的值）。 */
  readValue(): Promise<unknown>;
  isExplicit(): Promise<boolean>;
  /** `omp config set goal.continuationModes <modes>`，和设置页同一条路径。 */
  write(modes: string[]): Promise<void>;
}

export type GoalDefaultOutcome = "written" | "explicit" | "already-on";

export async function applyGoalContinuationDefault(deps: GoalDefaultDeps): Promise<GoalDefaultOutcome> {
  if (await deps.isExplicit()) return "explicit";
  const modes = goalDefaultWrite(await deps.readValue(), false);
  if (modes === null) return "already-on";
  await deps.write(modes);
  return "written";
}
