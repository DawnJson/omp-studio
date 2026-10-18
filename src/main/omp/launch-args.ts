// omp 启动参数和环境的纯函数部分：不 import electron 和 omp-manager，单元测试和录制脚本可以直接用。
import path from "node:path";
import type { ApprovalMode, ModelKey } from "../../shared/ipc.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";

export interface LaunchSpec {
  /** 项目目录。没有 RPC 命令能改 cwd，只能在 spawn 时定（arch 1.1）。 */
  cwd: string;
  model?: ModelKey | null;
  thinkingLevel?: ThinkingLevel | null;
  /** 任务进程：null = 不传，跟随 omp 的 tools.approvalMode；服务进程不传。 */
  approvalMode?: ApprovalMode | null;
  /** 服务进程：不落会话文件。 */
  noSession?: boolean;
  /** 项目目录就是用户主目录时 omp 会自动换到临时目录，要带 --allow-home（cli-reference.md）。 */
  allowHome?: boolean;
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
    throw new Error("STUDIO_TEST_OMP must be JSON like {\"command\": \"node\", \"args\": [\"fake-omp.ts\", \"fixture.ndjson\"]}");
  }
  return { command: value.command, args: value.args as string[] };
}

export function buildOmpArgs(spec: LaunchSpec): string[] {
  const args = ["--mode", "rpc-ui"];
  if (spec.noSession) args.push("--no-session");
  if (spec.model) args.push("--model", `${spec.model.provider}/${spec.model.modelId}`);
  if (spec.thinkingLevel && spec.thinkingLevel !== "inherit") args.push("--thinking", spec.thinkingLevel);
  if (spec.approvalMode) args.push("--approval-mode", spec.approvalMode);
  if (spec.allowHome) args.push("--allow-home");
  return args;
}

/** 把 `bin` 放到 PATH 最前（保持原有的变量名大小写：Windows 上常见 `Path`）。 */
export function prependToPath(env: NodeJS.ProcessEnv, bin: string): NodeJS.ProcessEnv {
  const key = process.platform === "win32" ? (Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "Path") : "PATH";
  const current = env[key];
  return { ...env, [key]: current ? `${bin}${path.delimiter}${current}` : bin };
}
