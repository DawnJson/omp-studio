// TSP 任务的改动卡片数据：工作区（含暂存区和未跟踪文件）相对 HEAD 的改动文件和每个文件的 +N −M。
// 基线选"相对 HEAD 的未提交改动"而不是"本轮开始时的快照"：评审面板列的就是这些文件，卡片和评审入口永远一致；
// 不需要在主进程任务状态机里挂钩子，也不会因为应用重启、历史任务而丢基线。代价是不在 worktree 里的任务
// 会把开跑前已有的未提交改动也算进来。
import { open, stat } from "node:fs/promises";
import path from "node:path";
import {
  GIT_DIFF_MAX_BYTES,
  type GitChangeEntry,
  type GitChangeSummary,
  type GitFileChange,
} from "../../shared/git.ts";
import { diffOfNewFile, looksBinary } from "./diff.ts";
import { git } from "./exec.ts";
import { findRepo, hasCommits } from "./repo.ts";
import { statusAt } from "./status.ts";

/** 一个文件的行数；null = 二进制或过大。 */
export interface LineStat {
  added: number | null;
  removed: number | null;
}

export interface NumstatEntry extends LineStat {
  path: string;
  oldPath: string | null;
}

/**
 * 解析 `git diff --numstat -z`：普通文件是 `A\tR\tpath\0`，重命名/复制是 `A\tR\t\0旧路径\0新路径\0`，
 * 二进制的 A、R 是 `-`。
 */
export function parseNumstatZ(text: string): NumstatEntry[] {
  const parts = text.split("\0");
  const out: NumstatEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i] ?? "";
    if (head === "") continue;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head);
    if (!match) continue;
    const added = match[1] === "-" ? null : Number(match[1]);
    const removed = match[2] === "-" ? null : Number(match[2]);
    if (match[3] === "") {
      const oldPath = parts[++i] ?? "";
      const newPath = parts[++i] ?? "";
      out.push({ path: newPath, oldPath, added, removed });
    } else {
      out.push({ path: match[3] ?? "", oldPath: null, added, removed });
    }
  }
  return out;
}

/** 合并：已跟踪的改动（numstat，相对 HEAD）在前，未跟踪文件在后；路径重复只留第一条。 */
export function mergeChanges(
  tracked: readonly NumstatEntry[],
  untracked: readonly (LineStat & { path: string })[],
): GitChangeEntry[] {
  const seen = new Set<string>();
  const out: GitChangeEntry[] = [];
  const push = (entry: GitChangeEntry) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    out.push(entry);
  };
  for (const entry of tracked) push({ ...entry });
  for (const entry of untracked) push({ path: entry.path, oldPath: null, added: entry.added, removed: entry.removed });
  return out;
}

/** 未跟踪文件的行数：二进制、过大、读不出来的返回 null（只显示文件名）。 */
export function untrackedLineStat(content: Buffer): LineStat {
  if (looksBinary(content)) return { added: null, removed: null };
  const diff = diffOfNewFile(content);
  return diff.kind === "text" ? { added: diff.added, removed: 0 } : { added: null, removed: null };
}

/** 未跟踪文件最多读这么多个；超出的只列文件名。node_modules 之类没被忽略时不能把读盘拖垮。 */
const UNTRACKED_READ_LIMIT = 200;

async function readUntracked(root: string, file: string): Promise<LineStat> {
  const full = path.join(root, file);
  try {
    const info = await stat(full);
    if (!info.isFile() || info.size > GIT_DIFF_MAX_BYTES) return { added: null, removed: null };
    const handle = await open(full, "r");
    try {
      return untrackedLineStat(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch {
    // 状态读取和读文件之间文件被删了：只列文件名。
    return { added: null, removed: null };
  }
}

export async function getGitChangeSummary(cwd: string): Promise<GitChangeSummary> {
  const repo = await findRepo(cwd);
  if (repo.kind !== "ok") return repo;
  const root = repo.root;
  // 还没有任何提交：没有 HEAD 可比，用暂存区相对空树。
  const args = (await hasCommits(root)) ? ["diff", "HEAD", "--numstat", "-z"] : ["diff", "--cached", "--numstat", "-z"];
  const [numstat, status] = await Promise.all([git(root, args), statusAt(root)]);
  const tracked = parseNumstatZ(numstat.toString("utf8"));
  const untrackedFiles = status.files.filter((file: GitFileChange) => file.unstaged === "untracked");
  const untracked: (LineStat & { path: string })[] = [];
  for (const [index, file] of untrackedFiles.entries()) {
    const lines = index < UNTRACKED_READ_LIMIT ? await readUntracked(root, file.path) : { added: null, removed: null };
    untracked.push({ path: file.path, ...lines });
  }
  return { kind: "ok", files: mergeChanges(tracked, untracked) };
}
