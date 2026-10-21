// 启动时关掉 omp 的首次运行引导：`startup.setupWizard` 用户没明确设置过，就经 `omp config set` 设成 false。
// 不 import electron，单元测试可以直接用。
//
// 为什么：空 agent 目录里 omp 18.12.5 交互模式（TSP 任务）启动后先画 5 步 `omp.app.setup` 引导，占满第一个任务、输入框发不出
// （docs/architecture/tsp-real-omp-probes.md §1）。仓库所有者 2026-10-21 批准这一处自动写入。
// 怎么分辨“明确设过”：同 goal-default.ts——`omp config set` 一定会把键写进 agent 目录的 config.yml，所以只读 config.yml，不写。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const setupWizardKey = "startup.setupWizard";

/** config.yml 里是否有 `startup.setupWizard`（嵌套 `startup: { setupWizard }` 或平铺的键都算）。读不了、解析不了时按“设过”处理：宁可不改。 */
export async function isSetupWizardExplicit(agentDir: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(agentDir, "config.yml"), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  let root: unknown;
  try {
    root = parse(text);
  } catch {
    return true;
  }
  if (root === null || root === undefined) return false;
  if (typeof root !== "object" || Array.isArray(root)) return true;
  const record = root as Record<string, unknown>;
  const startup = record["startup"];
  const nested =
    typeof startup === "object" && startup !== null && !Array.isArray(startup)
      ? (startup as Record<string, unknown>)
      : {};
  return setupWizardKey in record || "setupWizard" in nested;
}

export interface SetupWizardDefaultDeps {
  isExplicit(): Promise<boolean>;
  /** `omp config set startup.setupWizard false`，和设置页同一条路径。 */
  write(): Promise<void>;
}

export type SetupWizardDefaultOutcome = "written" | "explicit";

export async function applySetupWizardDefault(deps: SetupWizardDefaultDeps): Promise<SetupWizardDefaultOutcome> {
  if (await deps.isExplicit()) return "explicit";
  await deps.write();
  return "written";
}
