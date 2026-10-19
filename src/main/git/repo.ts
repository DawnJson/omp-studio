// 定位 git 仓库根。所有评审和 git 操作都在仓库根上跑，路径是相对仓库根的。
import { stat } from "node:fs/promises";
import path from "node:path";
import { CommandNotFoundError, GitError, gitRaw, failureMessage, gitText } from "./exec.ts";

export type RepoLookup = { kind: "git_missing" } | { kind: "not_git" } | { kind: "ok"; root: string };

export async function findRepo(cwd: string): Promise<RepoLookup> {
  // 目录不存在时 spawn 也报 ENOENT，会被误认成"没有 git"，所以先确认目录在。
  await stat(cwd);
  let result;
  try {
    result = await gitRaw(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    if (error instanceof CommandNotFoundError) return { kind: "git_missing" };
    throw error;
  }
  if (result.code === 0) return { kind: "ok", root: path.normalize(result.stdout.toString("utf8").trim()) };
  if (result.stderr.includes("not a git repository")) return { kind: "not_git" };
  throw new GitError(failureMessage(result), result.code);
}

/** 要求在仓库里；不是仓库或没有 git 时抛带原因的错误（IPC 把 message 带回界面）。 */
export async function requireRepoRoot(cwd: string): Promise<string> {
  const repo = await findRepo(cwd);
  if (repo.kind === "git_missing") throw new Error("git was not found on PATH");
  if (repo.kind === "not_git") throw new Error("the task directory is not a git repository");
  return repo.root;
}

/** 当前分支名；detached HEAD 返回 null。 */
export async function currentBranch(root: string): Promise<string | null> {
  const result = await gitRaw(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
}

/** 推送用的 remote：分支已配置 remote 就用它；否则只有一个 remote 用它，多个时取 origin；都没有是 null。 */
export async function pushRemote(
  root: string,
  branch: string,
): Promise<{ remote: string | null; hasUpstream: boolean }> {
  const configured = await gitRaw(root, ["config", "--get", `branch.${branch}.remote`]);
  if (configured.code === 0) return { remote: configured.stdout.toString("utf8").trim(), hasUpstream: true };
  const remotes = (await gitText(root, ["remote"])).split("\n").filter(Boolean);
  const remote = remotes.length === 1 ? (remotes[0] ?? null) : remotes.includes("origin") ? "origin" : null;
  return { remote, hasUpstream: false };
}

/** HEAD 是否指向一个提交（新仓库还没有任何提交时为 false）。 */
export async function hasCommits(root: string): Promise<boolean> {
  return (await gitRaw(root, ["rev-parse", "--verify", "-q", "HEAD"])).code === 0;
}

export function headCommit(root: string): Promise<string> {
  return gitText(root, ["rev-parse", "HEAD"]);
}
