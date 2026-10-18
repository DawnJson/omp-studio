// 组 omp 的启动参数和环境：给任务进程和服务进程共用。
// 启动参数见 omp 文档 cli-reference.md；API key 来自 omp-manager/api-keys.ts（safeStorage 加密存在 userData，决策 D3）。
import { getApiKeyEnv } from "../omp-manager/api-keys.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { buildOmpArgs, prependToPath, type LaunchSpec, type TestOmpOverride } from "./launch-args.ts";
import type { OmpLaunch } from "./omp-connection.ts";

let testOverride: TestOmpOverride | null = null;

export function setTestOmpOverride(override: TestOmpOverride | null): void {
  testOverride = override;
}

export async function buildOmpLaunch(spec: LaunchSpec): Promise<OmpLaunch> {
  const apiKeys = await getApiKeyEnv();
  if (testOverride) {
    return { command: testOverride.command, args: testOverride.args, cwd: spec.cwd, env: { ...process.env, ...apiKeys } };
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
