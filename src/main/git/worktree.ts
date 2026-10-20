// 任务 worktree：创建、setup 脚本、合并回基分支、丢弃、清理无主 worktree。决策和位置见 docs/architecture/git.md。
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GitMergeResult, TaskWorktreeInfo, WorktreeCleanupResult } from "../../shared/git.ts";
import { log } from "../log/log.ts";
import { git, gitRaw, gitText, runCommand } from "./exec.ts";
import { currentBranch, findRepo, hasCommits, headCommit } from "./repo.ts";
import { statusAt } from "./status.ts";

export const BRANCH_PREFIX = "studio/";
const SETUP_TIMEOUT_MS = 10 * 60_000;
const SETUP_OUTPUT_TAIL = 2000;

export interface CreatedWorktree {
  path: string;
  branch: string;
  baseBranch: string;
}

/** 项目目录必须正好是仓库根：任务的 cwd 就是 worktree 根，子目录项目没法一一对应。 */
async function requireRepoRootProject(projectPath: string): Promise<string> {
  const repo = await findRepo(projectPath);
  if (repo.kind === "git_missing") throw new Error("git was not found on PATH");
  if (repo.kind === "not_git") throw new Error("worktrees need a git repository");
  const [a, b] = await Promise.all([realpath(projectPath), realpath(repo.root)]);
  if (path.relative(a, b) !== "") throw new Error("the project folder must be the repository root to use a worktree");
  return repo.root;
}

/** 项目目录能不能开 worktree 任务（git 可用、目录正好是仓库根）。界面据此决定显不显示"工作树"开关；没提交、detached 等仍在创建时拒绝。 */
export async function isRepoRootProject(projectPath: string): Promise<boolean> {
  try {
    await requireRepoRootProject(projectPath);
    return true;
  } catch {
    return false;
  }
}

// ───────── setup 脚本 ─────────

export interface SetupScript {
  /** 相对仓库根的文件名，界面据此提示"创建时会运行 xxx"。 */
  name: string;
  /** 脚本文件的绝对路径。 */
  file: string;
  /** 文件内容的 sha256（十六进制）：用户的确认按它记，内容变了要重新确认。 */
  sha256: string;
}

/**
 * 项目级 setup 脚本：仓库根下 `.omp-studio/setup.ps1`（Windows）、`setup.cmd`（Windows）、`setup.sh`（其他系统），
 * 按这个顺序取第一个存在的。读的是主仓库里的那份（可以是还没提交的），在新 worktree 里运行。
 */
export async function findSetupScript(repoRoot: string): Promise<SetupScript | null> {
  const names = process.platform === "win32" ? ["setup.ps1", "setup.cmd"] : ["setup.sh"];
  for (const name of names) {
    const file = path.join(repoRoot, ".omp-studio", name);
    try {
      const bytes = await readFile(file);
      return { name: `.omp-studio/${name}`, file, sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch {
      // 不存在，试下一个
    }
  }
  return null;
}

function setupCommand(script: SetupScript): { command: string; args: string[]; verbatim: boolean } {
  if (script.file.endsWith(".ps1"))
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script.file],
      verbatim: false,
    };
  // cmd 的引号规则要自己控制：/s 让 cmd 只剥最外层引号，路径里的空格和括号才不出问题。
  if (script.file.endsWith(".cmd"))
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `""${script.file}""`], verbatim: true };
  return { command: "sh", args: [script.file], verbatim: false };
}

async function runSetupScript(script: SetupScript, repoRoot: string, worktreePath: string): Promise<void> {
  const { command, args, verbatim } = setupCommand(script);
  const result = await runCommand(command, args, {
    cwd: worktreePath,
    timeoutMs: SETUP_TIMEOUT_MS,
    // 输出再多也不让创建失败：只留结尾给错误信息用。
    keepTailBytes: SETUP_OUTPUT_TAIL * 4,
    windowsVerbatimArguments: verbatim,
    env: { ...process.env, OMP_STUDIO_PROJECT_DIR: repoRoot, OMP_STUDIO_WORKTREE_DIR: worktreePath },
  });
  if (result.code !== 0) {
    const output = `${result.stderr}\n${result.stdout.toString("utf8")}`.trim();
    throw new Error(`${script.name} failed (exit ${result.code}): ${output.slice(-SETUP_OUTPUT_TAIL)}`);
  }
}

// ───────── 创建（走 omp） ─────────

const repoHash = (repoRoot: string) => createHash("sha1").update(pathKey(repoRoot)).digest("hex").slice(0, 7);

function runOmp(ompPath: string, cwd: string, args: string[]) {
  return runCommand(ompPath, args, {
    cwd,
    timeoutMs: 120_000,
    keepTailBytes: 16 * 1024,
    // 输出是给程序读的：不要颜色转义。
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

/**
 * omp 存放 agent 管理的 worktree 的目录，解析顺序和 omp 一致（omp 文档 tools/github.md getWorktreesDir）：
 * `OMP_WORKTREE_DIR`（绝对或 ~ 开头）→ 设置 `worktree.base` → `~/.omp/wt`。
 */
export async function resolveWorktreesDir(ompPath: string, repoRoot: string): Promise<string> {
  const expand = (value: string): string | null => {
    const expanded = value === "~" || /^~[\\/]/.test(value) ? path.join(os.homedir(), value.slice(1)) : value;
    return path.isAbsolute(expanded) ? expanded : null;
  };
  const fromEnv = process.env["OMP_WORKTREE_DIR"];
  const envDir = fromEnv ? expand(fromEnv) : null;
  if (envDir) return envDir;
  const result = await runOmp(ompPath, repoRoot, ["config", "get", "worktree.base", "--json"]);
  if (result.code === 0) {
    try {
      const parsed: unknown = JSON.parse(result.stdout.toString("utf8"));
      const value = typeof parsed === "object" && parsed !== null && "value" in parsed ? parsed.value : null;
      const configured = typeof value === "string" && value !== "" ? expand(value) : null;
      if (configured) return configured;
    } catch {
      // 输出不是 JSON：当作没设置，用默认值。
    }
  }
  return path.join(os.homedir(), ".omp", "wt");
}

/** `omp worktree add -C <repo> -b <branch> <path> HEAD`。omp 在 add 时不自己选目录（必须给 PATH），失败时退出码非 0。 */
async function ompWorktreeAdd(ompPath: string, repoRoot: string, branch: string, worktreePath: string): Promise<void> {
  await mkdir(path.dirname(worktreePath), { recursive: true });
  const result = await runOmp(ompPath, repoRoot, [
    "worktree",
    "add",
    "-C",
    repoRoot,
    "-b",
    branch,
    "-q",
    worktreePath,
    "HEAD",
  ]);
  if (result.code !== 0)
    throw new Error(
      `omp worktree add failed: ${(result.stderr.trim() || result.stdout.toString("utf8").trim()).slice(-2000)}`,
    );
}

export interface CreateWorktreeOptions {
  /** 仓库里有 setup 脚本时必须给：返回 true 才会运行（用户确认过这个项目的这份内容）。没给或返回 false 则创建被拒绝，什么都不留。 */
  approveSetup?: (script: SetupScript) => boolean | Promise<boolean>;
  /** omp 可执行文件的绝对路径（omp-manager 当前就绪的那份）：worktree 由 `omp worktree add` 创建。 */
  ompPath: string;
}

/**
 * 从当前 HEAD 建分支 `studio/<slug>` 和 worktree。slug 是随机的 8 位十六进制：任务创建时还没有标题。
 * setup 脚本失败时回滚（移除 worktree 和分支）并抛错：在没装好依赖的目录里让 agent 干活只会产生误导性的失败。
 * 主仓库里没提交的改动不会带进 worktree。
 */
export async function createWorktree(projectPath: string, options: CreateWorktreeOptions): Promise<CreatedWorktree> {
  const repoRoot = await requireRepoRootProject(projectPath);
  if (!(await hasCommits(repoRoot)))
    throw new Error("the repository has no commits yet; commit once before using a worktree");
  const baseBranch = await currentBranch(repoRoot);
  if (baseBranch === null)
    throw new Error("the repository is on a detached HEAD; check out a branch before using a worktree");

  // 脚本是仓库里的可执行内容：没确认过就不创建（先于 worktree add，不留残余）。
  const approved = await findSetupScript(repoRoot);
  if (approved && !(await options.approveSetup?.(approved)))
    throw new Error(`setup script not approved: ${approved.name}`);

  const slug = randomUUID().slice(0, 8);
  const branch = `${BRANCH_PREFIX}${slug}`;
  // 目录由 omp 的规则决定（环境变量 / worktree.base / 默认 ~/.omp/wt）：这样 omp 的 `omp worktree list` 看得到它。
  // 目录名 <slug>-<仓库路径哈希>：不同仓库的 slug 即使碰撞也不会重名。
  const worktreePath = path.join(await resolveWorktreesDir(options.ompPath, repoRoot), `${slug}-${repoHash(repoRoot)}`);
  await ompWorktreeAdd(options.ompPath, repoRoot, branch, worktreePath);
  log.info("worktree created", { branch });

  try {
    if (approved) {
      // 确认之后脚本被改过：按没确认处理。
      const current = await findSetupScript(repoRoot);
      if (current?.sha256 !== approved.sha256) throw new Error(`setup script not approved: ${approved.name}`);
      await runSetupScript(approved, repoRoot, worktreePath);
    }
  } catch (error) {
    await removeWorktree(repoRoot, worktreePath, branch).catch((cleanupError: unknown) =>
      log.warn("worktree rollback failed", cleanupError),
    );
    throw error;
  }
  return { path: worktreePath, branch, baseBranch };
}

// ───────── 信息 ─────────

export async function worktreeInfo(repoRoot: string, branch: string, baseBranch: string): Promise<TaskWorktreeInfo> {
  const count = await gitRaw(repoRoot, ["rev-list", "--count", "--end-of-options", `${baseBranch}..${branch}`]);
  return { branch, baseBranch, commitsAhead: count.code === 0 ? Number(count.stdout.toString("utf8").trim()) : 0 };
}

// ───────── 合并 ─────────

/**
 * 在主仓库里把 worktree 分支合进基分支（`git merge --no-edit`，能快进就快进）。
 * 冲突时 `merge --abort` 退回合并前的状态并报告冲突文件，不做任何自动解决。
 * worktree 或主仓库有没提交的改动时拒绝：前者的改动不会被合并，后者可能被合并覆盖。
 */
export async function mergeWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  baseBranch: string,
): Promise<GitMergeResult> {
  const checkedOut = await currentBranch(repoRoot);
  if (checkedOut !== baseBranch) return { kind: "blocked", reason: "base_not_checked_out", currentBranch: checkedOut };
  if ((await statusAt(worktreePath)).files.length > 0) return { kind: "blocked", reason: "worktree_dirty" };
  if ((await statusAt(repoRoot)).files.some((file) => file.unstaged !== "untracked"))
    return { kind: "blocked", reason: "base_dirty" };
  if ((await worktreeInfo(repoRoot, branch, baseBranch)).commitsAhead === 0) return { kind: "nothing_to_merge" };

  const result = await gitRaw(repoRoot, ["merge", "--no-edit", "--end-of-options", branch]);
  if (result.code === 0) return { kind: "merged", commit: await headCommit(repoRoot) };

  const conflicts = (await gitText(repoRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]))
    .split("\0")
    .filter(Boolean);
  // 无论什么原因失败，都不能把主仓库留在合并中途。
  if ((await gitRaw(repoRoot, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code === 0)
    await git(repoRoot, ["merge", "--abort"]);
  if (conflicts.length > 0) return { kind: "conflict", files: conflicts };
  throw new Error((result.stderr.trim() || result.stdout.toString("utf8").trim() || "merge failed").slice(0, 4000));
}

// ───────── 丢弃和清理 ─────────

/** Windows 上杀毒/索引服务或刚被结束的进程会短暂占住目录：对这些错误码有限次重试（同 atomic-write.ts）。 */
async function rmWithRetry(target: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (attempt >= 8 || !["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(code)) throw error;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

/**
 * 只允许移除 studio 自己建的：分支必须是 studio/ 前缀，且这个目录必须是 git 登记在这个仓库名下、检出的正是这个分支的 worktree
 * （位置不再固定：omp 的目录、旧版的 .omp-studio-worktrees 都有，所以按登记认，不按路径认）。
 * 返回 false 表示目录已经没有登记（比如被 prune 过），调用方只需要处理分支。
 */
async function assertStudioWorktree(repoRoot: string, worktreePath: string, branch: string): Promise<boolean> {
  if (!branch.startsWith(BRANCH_PREFIX)) throw new Error("refusing to delete a branch that is not a studio branch");
  const registered = (await listWorktrees(repoRoot)).find((wt) => pathKey(wt.path) === pathKey(worktreePath));
  if (registered) {
    if (registered.branch !== branch) throw new Error("refusing to remove a worktree that is not on the task's branch");
    return true;
  }
  // 没登记但目录还在：不是 git 认识的 worktree，不动。
  if (
    await stat(worktreePath).then(
      () => true,
      () => false,
    )
  )
    throw new Error("refusing to remove a directory that is not a registered worktree");
  return false;
}

/** 移除 worktree（含未提交的改动）和它的分支。目录已经没了也不报错。omp 没有删除单个 worktree 的接口（`omp worktree clear` 按目录整体清），所以走 git。 */
export async function removeWorktree(repoRoot: string, worktreePath: string, branch: string): Promise<void> {
  if (await assertStudioWorktree(repoRoot, worktreePath, branch)) {
    await gitRaw(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    // remove 失败（目录被占用等）时目录可能还在；让 git 忘掉已经不存在的，再确认目录真的没了。
    await gitRaw(repoRoot, ["worktree", "prune"]);
    await rmWithRetry(worktreePath);
  }
  await gitRaw(repoRoot, ["worktree", "prune"]);
  if ((await gitRaw(repoRoot, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`])).code === 0)
    await git(repoRoot, ["branch", "-D", "--end-of-options", branch]);
  log.info("worktree removed", { branch });
}

interface RegisteredWorktree {
  path: string;
  branch: string | null;
}

async function listWorktrees(repoRoot: string): Promise<RegisteredWorktree[]> {
  const text = await gitText(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  const out: RegisteredWorktree[] = [];
  let current: RegisteredWorktree | null = null;
  for (const field of text.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: path.normalize(field.slice(9)), branch: null };
      out.push(current);
    } else if (field.startsWith("branch refs/heads/") && current)
      current.branch = field.slice("branch refs/heads/".length);
  }
  return out;
}

const pathKey = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * 清理无主 worktree：先 `git worktree prune`（目录已不在的登记），再看 git 登记的、分支是 `studio/` 前缀、没有任何任务记录
 * 引用的 worktree（不管在 omp 的目录还是旧版的 .omp-studio-worktrees 里）。只删"干净且分支已合入 HEAD"的；
 * 有未提交改动、有未合并提交的保留并报告。不用 `omp worktree clear`：它按目录整体清，--all 会清掉别的仓库和别的工具建的。
 * `referenced` 是所有任务记录（含已归档）里的 worktreePath。
 */
export async function cleanupOrphanWorktrees(
  repoRoot: string,
  referenced: readonly string[],
): Promise<WorktreeCleanupResult> {
  const result: WorktreeCleanupResult = { removed: [], kept: [] };
  await gitRaw(repoRoot, ["worktree", "prune"]);
  const used = new Set(referenced.map(pathKey));
  const mine = (await listWorktrees(repoRoot)).filter(
    (wt) => pathKey(wt.path) !== pathKey(repoRoot) && wt.branch?.startsWith(BRANCH_PREFIX),
  );
  for (const wt of mine) {
    if (used.has(pathKey(wt.path)) || wt.branch === null) continue;
    const name = path.basename(wt.path);
    if ((await statusAt(wt.path)).files.length > 0) {
      result.kept.push({ name, reason: "dirty" });
      continue;
    }
    const merged = await gitRaw(repoRoot, ["merge-base", "--is-ancestor", wt.branch, "HEAD"]);
    if (merged.code !== 0) {
      result.kept.push({ name, reason: "unmerged" });
      continue;
    }
    await removeWorktree(repoRoot, wt.path, wt.branch);
    result.removed.push(name);
  }
  return result;
}
