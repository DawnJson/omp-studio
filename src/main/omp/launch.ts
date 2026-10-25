// 组 omp 的启动参数和环境：给任务进程和服务进程共用。
// 启动参数见 omp 文档 cli-reference.md；凭据（OAuth、设置页存的 API key）都在 omp 自己的凭据库里，这里不注入。
import { awaitStartupDefaults } from "../omp-config/startup-defaults.ts";
import { accountExtensionPath } from "../client-accounts/extension-path.ts";
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
  if (testOverride) {
    return {
      command: testOverride.command,
      args: testOverride.args,
      cwd: spec.cwd,
      env: { ...process.env },
    };
  }
  const executable = await getOmpExecutable();
  return {
    command: executable.path,
    args: buildOmpArgs({ ...spec, extension: accountExtensionPath() }),
    cwd: spec.cwd,
    env: prependToPath({ ...process.env }, executable.managedBin),
  };
}

/** TSP 任务（伪终端里的交互式 omp）的启动：可执行文件和测试替换与 rpc-ui 后台进程一致，参数不带 `--mode rpc-ui`。 */
export async function buildTspLaunch(spec: TspLaunchSpec): Promise<OmpLaunch> {
  if (testOverride) {
    return {
      command: testOverride.command,
      args: testOverride.args,
      cwd: spec.cwd,
      env: { ...process.env },
    };
  }
  // 真 omp 的首次运行引导由启动默认关掉；第一个任务的进程要等它写完，否则还会看到引导。超时/失败都照常启动。
  await awaitStartupDefaults(STARTUP_DEFAULTS_WAIT_MS);
  const executable = await getOmpExecutable();
  return {
    command: executable.path,
    args: buildTspArgs({ ...spec, extension: accountExtensionPath() }),
    cwd: spec.cwd,
    env: prependToPath({ ...process.env }, executable.managedBin),
  };
}
