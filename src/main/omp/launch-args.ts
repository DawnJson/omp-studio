// omp 启动参数和环境的纯函数部分：不 import electron 和 omp-manager，单元测试和录制脚本可以直接用。
import path from "node:path";
import type { ModelKey } from "../../shared/ipc.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";

export interface LaunchSpec {
  /** 项目目录。没有 RPC 命令能改 cwd，只能在 spawn 时定（arch 1.1）。 */
  cwd: string;
  model?: ModelKey | null;
  thinkingLevel?: ThinkingLevel | null;
  /** 服务进程：不落会话文件。 */
  noSession?: boolean;
  /** 项目目录就是用户主目录时 omp 会自动换到临时目录，要带 --allow-home（cli-reference.md）。 */
  allowHome?: boolean;
  /** `--config` 覆盖文件（绝对路径）：给这个进程加一份 config.yml 风格的设置，只对本次运行生效，不写用户的配置。 */
  configOverlay?: string;
}

/** 只在 `!app.isPackaged` 时由运行时设置，指向 `node test/fake-omp/fake-omp.ts <fixture>`（STUDIO_TEST_OMP）。 */
export interface TestOmpOverride {
  command: string;
  args: string[];
}

/** `STUDIO_TEST_OMP` 是 JSON `{command, args}`；形状不对直接抛错，别悄悄退回真实 omp。 */
export function parseTestOmpOverride(json: string): TestOmpOverride {
  const value: unknown = JSON.parse(json);
  if (
    typeof value !== "object" ||
    value === null ||
    !("command" in value) ||
    typeof value.command !== "string" ||
    !("args" in value) ||
    !Array.isArray(value.args) ||
    !value.args.every((arg: unknown) => typeof arg === "string")
  ) {
    throw new Error('STUDIO_TEST_OMP must be JSON like {"command": "node", "args": ["fake-omp.ts", "fixture.ndjson"]}');
  }
  return { command: value.command, args: value.args as string[] };
}

export function buildOmpArgs(spec: LaunchSpec): string[] {
  // 不传 --approval-mode：审批模式只看 omp 自己的 tools.approvalMode（输入框改的也是它）。
  const args = ["--mode", "rpc-ui"];
  if (spec.noSession) args.push("--no-session");
  if (spec.model) args.push("--model", `${spec.model.provider}/${spec.model.modelId}`);
  if (spec.thinkingLevel && spec.thinkingLevel !== "inherit") args.push("--thinking", spec.thinkingLevel);
  if (spec.allowHome) args.push("--allow-home");
  if (spec.configOverlay) args.push("--config", spec.configOverlay);
  return args;
}

/**
 * 让 rpc-ui 下的目标自己继续的覆盖内容。`goal.continuationModes` 只有 interactive、rpc 两个取值；覆盖文件对数组是整体替换
 * （实测），所以写全部两个值：用户配置里不管是什么，在 omp-studio 里都等价于“再加上 rpc”。
 */
export const goalContinuationOverlay = "goal:\n  continuationModes: [interactive, rpc]\n";

/** 把 `bin` 放到 PATH 最前（保持原有的变量名大小写：Windows 上常见 `Path`）。 */
export function prependToPath(env: NodeJS.ProcessEnv, bin: string): NodeJS.ProcessEnv {
  const key =
    process.platform === "win32" ? (Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "Path") : "PATH";
  const current = env[key];
  return { ...env, [key]: current ? `${bin}${path.delimiter}${current}` : bin };
}
