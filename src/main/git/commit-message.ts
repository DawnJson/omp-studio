// "生成提交信息"：跑 `omp commit --dry-run --no-changelog`，从它的输出里取出提交信息，填进提交框。
// 实测（omp 18.12.6，docs/architecture/git.md）：
// - 模型由 omp 自己按 `commit` 角色（再退到 `smol`）选，不传 `-m`；
// - 只看已暂存的改动；但**一个都没暂存时它会自己 `git add` 全部**（dry-run 也一样），所以没有暂存内容时我们根本不运行它；
// - `--dry-run` 不提交；`--no-changelog` 不碰 CHANGELOG；工作区和索引都不变；
// - 它会在 omp 的会话目录里留一个会话文件（和终端里跑 `omp commit` 一样）；会话文件归 omp，studio 不删；
// - 信息在 stdout 最后的 "Generated commit message:" 之后；建议拆成多个提交时是 "Split commit plan (dry run):"；
// - 没有可用模型 / 回退到确定性信息（智能体出错）时退出码 1。
import { stripAnsi } from "../../shared/ansi.ts";
import { splitCommitMessage, type GitCommitMessageResult } from "../../shared/git.ts";
import { runCommand } from "./exec.ts";
import { requireRepoRoot } from "./repo.ts";
import { statusAt } from "./status.ts";

const GENERATE_TIMEOUT_MS = 3 * 60_000;
const MESSAGE_MARKER = "Generated commit message:\n";
const SPLIT_MARKER = "Split commit plan (dry run):\n";

/** 怎么运行 omp：测试和 e2e 用 node 跑假 omp，所以命令带前置参数。 */
export interface OmpCommand {
  command: string;
  /** 放在 `commit …` 前面的参数（假 omp 的脚本路径）。 */
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

export interface ParsedCommitOutput {
  title: string;
  body: string;
  /** omp 建议拆成几个提交；单个提交为 null。 */
  split: number | null;
}

/** 从 `omp commit --dry-run` 的 stdout 取提交信息；没有识别出信息返回 null。 */
export function parseOmpCommitOutput(stdout: string): ParsedCommitOutput | null {
  const text = stripAnsi(stdout).replace(/\r\n/g, "\n");
  const single = text.lastIndexOf(MESSAGE_MARKER);
  if (single !== -1) {
    const message = text.slice(single + MESSAGE_MARKER.length).trim();
    return message === "" ? null : { ...splitMessage(message), split: null };
  }
  const split = text.lastIndexOf(SPLIT_MARKER);
  if (split === -1) return null;
  // "Commit 1:\n<信息>\nChanges: a.txt, b.txt\nCommit 2:\n…"；信息在 "Commit N:" 和 "Changes:" 行之间。
  const commits = text
    .slice(split + SPLIT_MARKER.length)
    .split(/^Commit \d+:\n/m)
    .slice(1)
    .map((chunk) => {
      const changes = chunk.search(/^Changes: /m);
      return (changes === -1 ? chunk : chunk.slice(0, changes)).trim();
    })
    .filter((message) => message !== "");
  const first = commits[0];
  return first === undefined ? null : { ...splitMessage(first), split: commits.length };
}

function splitMessage(message: string): { title: string; body: string } {
  const { summary, description } = splitCommitMessage(message);
  return { title: summary, body: description };
}

/** stderr 里最有用的一行：omp 的错误行（`error: …` / `Agent error: …`），没有就取最后一行非空行。 */
function errorLine(stderr: string): string {
  const lines = stripAnsi(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const tagged = lines.find((line) => /^(Agent )?error:/i.test(line)) ?? lines[lines.length - 1] ?? "";
  return tagged.slice(0, 500);
}

/**
 * 用 omp 为已暂存的改动生成提交信息。没有已暂存的改动时不运行 omp（它会自己暂存全部）；
 * `signal` 取消时结束进程并返回 cancelled。参数是数组、不经 shell，cwd = 仓库根。
 */
export async function generateCommitMessage(
  cwd: string,
  omp: OmpCommand,
  signal: AbortSignal,
): Promise<GitCommitMessageResult> {
  const root = await requireRepoRoot(cwd);
  const { files } = await statusAt(root);
  if (!files.some((file) => file.staged !== null && file.staged !== "conflicted")) return { kind: "nothing_staged" };
  try {
    const result = await runCommand(omp.command, [...omp.args, "commit", "--dry-run", "--no-changelog"], {
      cwd: root,
      env: omp.env,
      timeoutMs: GENERATE_TIMEOUT_MS,
      signal,
    });
    const stderr = result.stderr;
    if (result.code !== 0) {
      return /No model available|No API key available/i.test(stderr)
        ? { kind: "no_model" }
        : { kind: "failed", message: errorLine(stderr) || `omp exited with code ${result.code}` };
    }
    const parsed = parseOmpCommitOutput(result.stdout.toString("utf8"));
    if (parsed === null) return { kind: "failed", message: "omp did not print a commit message" };
    return { kind: "generated", ...parsed };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
    throw error;
  }
}
