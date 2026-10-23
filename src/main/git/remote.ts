// 提交、推送、开 PR。永远不强推；提交信息和 PR 正文走 stdin。
import type {
  GitCommitResult,
  GitLastCommit,
  GitPullRequestInput,
  GitPullRequestResult,
  GitPushResult,
} from "../../shared/git.ts";
import { log } from "../log/log.ts";
import { CommandNotFoundError, failureMessage, git, gitRaw, gitText, runCommand, type RunOptions } from "./exec.ts";
import { currentBranch, hasCommits, headCommit, pushRemote, requireRepoRoot } from "./repo.ts";
import { statusAt } from "./status.ts";

const PUSH_TIMEOUT_MS = 5 * 60_000;

/**
 * 提交。stageAll 为 true 时先 `git add -A`；否则只提交已暂存的内容。
 * amend 为 true 时改写 HEAD（`commit --amend`）：不要求有暂存内容（只改信息也行），暂存的改动并入上一次提交。
 * 是否改写已推送的提交由调用方（界面）在这之前让用户确认；这里不推送，更不强推。
 */
export async function commit(cwd: string, message: string, stageAll: boolean, amend = false): Promise<GitCommitResult> {
  const root = await requireRepoRoot(cwd);
  if (message.trim() === "") throw new Error("commit message is empty");
  if (amend && !(await hasCommits(root))) return { kind: "failed", message: "there is no commit to amend" };
  if (stageAll) await git(root, ["add", "-A"]);
  const { files } = await statusAt(root);
  if (files.some((file) => file.staged === "conflicted"))
    return { kind: "failed", message: "resolve the merge conflicts before committing" };
  if (!amend && !files.some((file) => file.staged !== null)) return { kind: "nothing_to_commit" };
  const result = await gitRaw(root, ["commit", ...(amend ? ["--amend"] : []), "-F", "-"], { input: message });
  if (result.code !== 0) {
    log.warn("git commit failed", failureMessage(result));
    return { kind: "failed", message: failureMessage(result) };
  }
  return { kind: "committed", commit: await headCommit(root) };
}

/** 上一次提交（HEAD）的信息和是否已在远端分支里；还没有提交返回 null。 */
export async function lastCommit(cwd: string): Promise<GitLastCommit | null> {
  const root = await requireRepoRoot(cwd);
  if (!(await hasCommits(root))) return null;
  const [message, notOnRemote] = await Promise.all([
    gitText(root, ["log", "-1", "--format=%B"]),
    gitText(root, ["rev-list", "-n1", "HEAD", "--not", "--remotes"]),
  ]);
  return { commit: await headCommit(root), message: message.trimEnd(), pushed: notOnRemote === "" };
}

/** 推送当前分支。已有 upstream 就照它推；没有就选 remote（只有一个就用它，否则 origin）并设 upstream。 */
export async function push(cwd: string): Promise<GitPushResult> {
  const root = await requireRepoRoot(cwd);
  const branch = await currentBranch(root);
  if (branch === null) return { kind: "detached_head" };
  const { remote, hasUpstream } = await pushRemote(root, branch);
  if (remote === null) return { kind: "no_remote" };
  // 完整 refspec：分支名以 `+` 开头时 `push <remote> +foo` 会变成强推。目标取 branch.<b>.merge（上游分支名可能不同），
  // 没有就用同名；没有任何 force 参数。--end-of-options 防止 remote 名被当成选项。
  const merge = hasUpstream
    ? (await gitRaw(root, ["config", "--get", `branch.${branch}.merge`])).stdout.toString("utf8").trim()
    : "";
  const target = merge.startsWith("refs/heads/") ? merge : `refs/heads/${branch}`;
  const refspec = `refs/heads/${branch}:${target}`;
  const args = hasUpstream
    ? ["push", "--end-of-options", remote, refspec]
    : ["push", "--set-upstream", "--end-of-options", remote, refspec];
  const result = await gitRaw(root, args, { timeoutMs: PUSH_TIMEOUT_MS });
  if (result.code === 0) return { kind: "pushed", remote, branch };
  const message = failureMessage(result);
  log.warn("git push failed", message);
  return /\[rejected\]|non-fast-forward|fetch first/.test(message)
    ? { kind: "rejected", message }
    : { kind: "failed", message };
}

/** `gh pr create`；gh 不在 PATH 上（或没登录）是类型化结果。`env` 只给测试用来隐藏 gh。 */
export async function createPullRequest(
  cwd: string,
  input: GitPullRequestInput,
  base: string | null,
  env?: NodeJS.ProcessEnv,
): Promise<GitPullRequestResult> {
  const root = await requireRepoRoot(cwd);
  const branch = await currentBranch(root);
  if (branch === null) return { kind: "failed", message: "HEAD is detached; check out a branch first" };
  if (input.title.trim() === "") throw new Error("PR title is empty");
  const args = ["pr", "create", "--title", input.title, "--body-file", "-", "--head", branch];
  if (base !== null) args.push("--base", base);
  const options: RunOptions = { cwd: root, input: input.body, timeoutMs: PUSH_TIMEOUT_MS, ...(env && { env }) };
  let result;
  try {
    result = await runCommand("gh", args, options);
  } catch (error) {
    if (error instanceof CommandNotFoundError) return { kind: "gh_unavailable" };
    throw error;
  }
  if (result.code === 0) {
    const url = result.stdout.toString("utf8").trim().split(/\r?\n/).pop() ?? "";
    return { kind: "created", url };
  }
  const message = failureMessage(result);
  log.warn("gh pr create failed", message);
  return /gh auth login|not logged in|GH_TOKEN/i.test(message)
    ? { kind: "gh_unauthenticated" }
    : { kind: "failed", message };
}
