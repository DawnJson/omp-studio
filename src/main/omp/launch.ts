// 组 omp 的启动参数和环境：给任务进程和服务进程共用。
// 启动参数见 omp 文档 cli-reference.md；API key 来自 omp-manager/api-keys.ts（safeStorage 加密存在 userData，决策 D3）。
import { getApiKeyEnv } from "../omp-manager/api-keys.ts";
import { awaitStartupDefaults } from "../omp-config/startup-defaults.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import {
  buildOmpArgs,
  buildTspArgs,
  prependToPath,
  type LaunchSpec,
  type TestOmpOverride,
  type TspLaunchSpec,
} from "./launch-args.ts";
import type { OmpLaunch } from "./omp-connection.ts";

/** 等启动默认（`omp config set`）的上限；正常几百毫秒。 */
const STARTUP_DEFAULTS_WAIT_MS = 15_000;

let testOverride: TestOmpOverride | null = null;

export function setTestOmpOverride(override: TestOmpOverride | null): void {
  testOverride = override;
}

export async function buildOmpLaunch(spec: LaunchSpec): Promise<OmpLaunch> {
  const apiKeys = await getApiKeyEnv();
  if (testOverride) {
    return {
      command: testOverride.command,
      args: testOverride.args,
      cwd: spec.cwd,
      env: { ...process.env, ...apiKeys },
    };
  }
  const executable = await getOmpExecutable();
  const env = { ...process.env, ...apiKeys };
  return {
    command: executable.path,
    args: buildOmpArgs(spec),
    cwd: spec.cwd,
    env: executable.managedBin ? prependToPath(env, executable.managedBin) : env,
  };
}

/** TSP 任务（伪终端里的交互式 omp）的启动：可执行文件、API key 环境变量和测试替换与 rpc-ui 后台进程一致，参数不带 `--mode rpc-ui`。 */
export async function buildTspLaunch(spec: TspLaunchSpec): Promise<OmpLaunch> {
  const apiKeys = await getApiKeyEnv();
  if (testOverride) {
    return {
      command: testOverride.command,
      args: testOverride.args,
      cwd: spec.cwd,
      env: { ...process.env, ...apiKeys },
    };
  }
  // 真 omp 的首次运行引导由启动默认关掉；第一个任务的进程要等它写完，否则还会看到引导。超时/失败都照常启动。
  await awaitStartupDefaults(STARTUP_DEFAULTS_WAIT_MS);
  const executable = await getOmpExecutable();
  const env = { ...process.env, ...apiKeys };
  return {
    command: executable.path,
    args: buildTspArgs(spec),
    cwd: spec.cwd,
    env: executable.managedBin ? prependToPath(env, executable.managedBin) : env,
  };
}
