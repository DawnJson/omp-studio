// `git status --porcelain=v2 -z --branch` 的解析。-z 下路径不转义，中文和空格都原样。
import type { GitBranchInfo, GitChangeKind, GitFileChange, GitStatus } from "../../shared/git.ts";
import { git } from "./exec.ts";
import { findRepo, pushRemote } from "./repo.ts";

const KIND_BY_CODE: Record<string, GitChangeKind | undefined> = {
  M: "modified",
  T: "typechange",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
};

/** 取第 n 个空格之后的全部内容（路径本身可能含空格，所以不能整行 split）。 */
function afterFields(entry: string, n: number): string {
  let index = -1;
  for (let i = 0; i < n; i++) index = entry.indexOf(" ", index + 1);
  return entry.slice(index + 1);
}

export function parseStatusV2(text: string): { branch: GitBranchInfo; files: GitFileChange[] } {
  const branch: GitBranchInfo = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const files: GitFileChange[] = [];
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    if (entry === "") continue;
    if (entry.startsWith("# ")) {
      const [key = "", ...rest] = entry.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
        }
      }
    } else if (entry.startsWith("1 ")) {
      const staged = KIND_BY_CODE[entry[2] ?? "."] ?? null;
      const unstaged = KIND_BY_CODE[entry[3] ?? "."] ?? null;
      files.push({ path: afterFields(entry, 8), oldPath: null, staged, unstaged });
    } else if (entry.startsWith("2 ")) {
      // 重命名/复制：原路径是下一段。
      const staged = KIND_BY_CODE[entry[2] ?? "."] ?? null;
      const unstaged = KIND_BY_CODE[entry[3] ?? "."] ?? null;
      files.push({ path: afterFields(entry, 9), oldPath: parts[++i] ?? null, staged, unstaged });
    } else if (entry.startsWith("u ")) {
      files.push({ path: afterFields(entry, 10), oldPath: null, staged: "conflicted", unstaged: "conflicted" });
    } else if (entry.startsWith("? ")) {
      files.push({ path: entry.slice(2), oldPath: null, staged: null, unstaged: "untracked" });
    }
    // "! " 是被忽略的文件，只有 --ignored 才会出现，这里没传。
  }
  return { branch, files };
}

/** 没有上游时才需要查 remote；结果短暂缓存，状态读取很频繁，不能每次多起 1–2 个 git 进程。 */
const CAN_PUSH_TTL_MS = 10_000;
const canPushCache = new Map<string, { at: number; value: boolean }>();

async function canPushFrom(root: string, branch: GitBranchInfo): Promise<boolean> {
  if (branch.head === null) return false;
  // 有上游就一定配了 remote，状态里已经有，不用再问 git。
  if (branch.upstream !== null) return true;
  const key = `${root}\0${branch.head}`;
  const hit = canPushCache.get(key);
  if (hit && Date.now() - hit.at < CAN_PUSH_TTL_MS) return hit.value;
  canPushCache.delete(key);
  const value = (await pushRemote(root, branch.head)).remote !== null;
  canPushCache.set(key, { at: Date.now(), value });
  return value;
}

/** 仓库状态；不在仓库里或没有 git 是正常的类型化结果，不抛错。 */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const repo = await findRepo(cwd);
  if (repo.kind !== "ok") return repo;
  const status = await statusAt(repo.root);
  const canPush = await canPushFrom(repo.root, status.branch);
  return { kind: "ok", ...status, canPush };
}

/** 在仓库根上取状态（--untracked-files=all：未跟踪目录展开成文件，评审要逐文件看）。 */
export async function statusAt(root: string): Promise<{ branch: GitBranchInfo; files: GitFileChange[] }> {
  const raw = await git(root, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]);
  return parseStatusV2(raw.toString("utf8"));
}
