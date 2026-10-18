// 运行 git / gh：不经 shell，参数一律用数组；输出按 Buffer 收（文件内容可能不是 UTF-8）。
// 不 import electron，单元测试直接用真实的临时仓库。
import { spawn } from "node:child_process";

export interface RunOptions {
  cwd: string;
  /** 写进 stdin 的内容（提交信息、PR 正文走这里，不放命令行：命令行里的中文和换行在 Windows 上不可靠）。 */
  input?: string | Buffer;
  /** stdout 超过这个字节数就杀掉进程并抛 OutputTooLargeError。 */
  maxBuffer?: number;
  timeoutMs?: number;
  /** 完整替换环境变量（测试用来隐藏 PATH 上的 gh）。 */
  env?: NodeJS.ProcessEnv;
  /** Windows 上原样传参数（cmd.exe /s /c "…" 要自己控制引号）。 */
  windowsVerbatimArguments?: boolean;
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** 命令不在 PATH 上（spawn ENOENT）。 */
export class CommandNotFoundError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`${command} was not found on PATH`);
    this.name = "CommandNotFoundError";
    this.command = command;
  }
}

export class OutputTooLargeError extends Error {
  constructor() {
    super("command output is too large");
    this.name = "OutputTooLargeError";
  }
}

/** git 以非 0 退出；message 是 stderr（没有则是 stdout）的原话。 */
export class GitError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "GitError";
    this.code = code;
  }
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const STDERR_CAP = 64 * 1024;

export function runCommand(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    windowsHide: true,
    ...(options.windowsVerbatimArguments && { windowsVerbatimArguments: true }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  let settled = false;
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    action();
  };
  const timer = setTimeout(() => {
    child.kill();
    finish(() => reject(new Error(`${command} timed out`)));
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  child.stdout.on("data", (chunk: Buffer) => {
    outBytes += chunk.length;
    if (outBytes > maxBuffer) {
      child.kill();
      finish(() => reject(new OutputTooLargeError()));
      return;
    }
    out.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (errBytes >= STDERR_CAP) return;
    errBytes += chunk.length;
    err.push(chunk);
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    finish(() => reject(error.code === "ENOENT" ? new CommandNotFoundError(command) : error));
  });
  child.on("close", (code) => {
    finish(() =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }),
    );
  });
  // 子进程提前退出时写 stdin 会 EPIPE，结果由 close 事件报告。
  child.stdin.on("error", () => {});
  child.stdin.end(options.input ?? "");
  return promise;
}

// core.quotepath=off：非 ASCII 路径不转义成 "\346..."；--literal-pathspecs：路径里的 * ? [ 不当通配符。
const GIT_PREFIX = ["-c", "core.quotepath=off", "--literal-pathspecs"];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // 不弹凭据输入、不开编辑器；LC_ALL=C 让 stderr 是英文，识别 push 被拒这类情况时不受界面语言影响。
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_EDITOR: "true",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
}

/** 运行 git，不检查退出码。 */
export function gitRaw(cwd: string, args: readonly string[], options: Partial<RunOptions> = {}): Promise<RunResult> {
  return runCommand("git", [...GIT_PREFIX, ...args], { cwd, env: gitEnv(), ...options });
}

export function failureMessage(result: RunResult): string {
  return (result.stderr.trim() || result.stdout.toString("utf8").trim() || `exit code ${result.code}`).slice(0, 4000);
}

/** 运行 git，非 0 退出抛 GitError；返回 stdout 的 Buffer。 */
export async function git(cwd: string, args: readonly string[], options: Partial<RunOptions> = {}): Promise<Buffer> {
  const result = await gitRaw(cwd, args, options);
  if (result.code !== 0) throw new GitError(failureMessage(result), result.code);
  return result.stdout;
}

/** 运行 git，返回去掉末尾换行的 UTF-8 文本。 */
export async function gitText(
  cwd: string,
  args: readonly string[],
  options: Partial<RunOptions> = {},
): Promise<string> {
  return (await git(cwd, args, options)).toString("utf8").replace(/\r?\n$/, "");
}
