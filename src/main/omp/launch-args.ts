// omp 启动参数和环境的纯函数部分：不 import electron 和 omp-manager，单元测试可以直接用。
import path from "node:path";
import type { ModelKey } from "../../shared/ipc.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";

/** `--mode rpc-ui` 后台进程（服务进程、项目 rpc-ui 池）的启动参数；任务进程是 TSP，见 TspLaunchSpec。 */
export interface LaunchSpec {
  /** 工作目录。没有 RPC 命令能改 cwd，只能在 spawn 时定。 */
  cwd: string;
  /** 不落会话文件。 */
  noSession?: boolean;
}

/** 只在 `!app.isPackaged` 时由运行时设置，指向 `node test/fake-omp/fake-tsp-omp.ts <录制>`（STUDIO_TEST_OMP）。 */
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
    throw new Error('STUDIO_TEST_OMP must be JSON like {"command": "node", "args": ["fake-tsp-omp.ts", "task"]}');
  }
  return { command: value.command, args: value.args as string[] };
}

export function buildOmpArgs(spec: LaunchSpec): string[] {
  // 不传 --approval-mode：审批模式只看 omp 自己的 tools.approvalMode（输入框改的也是它）。
  const args = ["--mode", "rpc-ui"];
  if (spec.noSession) args.push("--no-session");
  return args;
}

export interface TspLaunchSpec {
  cwd: string;
  model?: ModelKey | null;
  thinkingLevel?: ThinkingLevel | null;
  allowHome?: boolean;
  /** 恢复这个会话文件（omp 的 `--resume <路径>`）；新任务为 null。 */
  resumeSessionFile?: string | null;
  /** 从这个会话文件分叉（omp 的 `--fork=<路径>`：复制它建一个新会话并在新会话里启动，原文件不动）；和 resumeSessionFile 二选一，后者优先。 */
  forkSessionFile?: string | null;
}

/** TSP 任务：交互式 omp（没有 `--mode`），恢复会话用 `--resume=<路径>`。 */
export function buildTspArgs(spec: TspLaunchSpec): string[] {
  const args: string[] = [];
  if (spec.resumeSessionFile) args.push(`--resume=${spec.resumeSessionFile}`);
  else if (spec.forkSessionFile) args.push(`--fork=${spec.forkSessionFile}`);
  if (spec.model) args.push("--model", `${spec.model.provider}/${spec.model.modelId}`);
  if (spec.thinkingLevel && spec.thinkingLevel !== "inherit") args.push("--thinking", spec.thinkingLevel);
  if (spec.allowHome) args.push("--allow-home");
  return args;
}

/** 把 `bin` 放到 PATH 最前（保持原有的变量名大小写：Windows 上常见 `Path`）；`bin` 为空（非自管 omp）时原样返回 env。 */
export function prependToPath(env: NodeJS.ProcessEnv, bin: string | null): NodeJS.ProcessEnv {
  if (!bin) return env;
  const key =
    process.platform === "win32" ? (Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "Path") : "PATH";
  const current = env[key];
  return { ...env, [key]: current ? `${bin}${path.delimiter}${current}` : bin };
}
