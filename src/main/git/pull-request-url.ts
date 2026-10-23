// PR 号 → 浏览器地址。omp 的 PR 号来自 `gh`（GitHub / GitHub Enterprise），页面是 `https://<主机>/<owner>/<repo>/pull/<号>`；
// 地址由任务目录里当前分支的 remote（和推送用同一个，repo.ts 的 pushRemote）的 URL 推出，不依赖 gh 在 PATH 上。
import { gitText } from "./exec.ts";
import { currentBranch, pushRemote, requireRepoRoot } from "./repo.ts";

/**
 * remote URL → `https://host/owner/repo`；认不出（本地路径、没有 owner/repo 两段）为 null。
 * 认 `https://[user[:token]@]host/o/r(.git)`、`git@host:o/r(.git)`、`ssh://git@host[:port]/o/r(.git)`、`git://host/o/r(.git)`；凭据一律丢掉。
 */
export function repoWebUrl(remoteUrl: string): string | null {
  const text = remoteUrl.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)([^/\s][^\s]*)$/.exec(text);
  const url = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/([^\s]+)$/i.exec(text);
  const match = url ?? scp;
  if (!match) return null;
  const parts = (match[2] as string)
    .replace(/\.git\/?$/i, "")
    .replace(/\/+$/, "")
    .split("/");
  if (parts.length < 2 || parts.some((part) => part === "")) return null;
  return `https://${match[1] as string}/${parts.join("/")}`;
}

export function pullRequestUrl(remoteUrl: string, number: number): string | null {
  const repo = repoWebUrl(remoteUrl);
  return repo === null ? null : `${repo}/pull/${number}`;
}

/** 任务目录里当前分支的 PR 页面地址；不是仓库、detached、没有 remote 或认不出 remote 的写法时抛带原因的错误。 */
export async function taskPullRequestUrl(cwd: string, number: number): Promise<string> {
  const root = await requireRepoRoot(cwd);
  const branch = await currentBranch(root);
  if (branch === null) throw new Error("HEAD is detached; there is no branch pull request");
  const { remote } = await pushRemote(root, branch);
  if (remote === null) throw new Error("the repository has no remote to build a pull request address from");
  const url = pullRequestUrl(await gitText(root, ["remote", "get-url", remote]), number);
  if (url === null) throw new Error("the remote address is not a GitHub-style repository URL");
  return url;
}
