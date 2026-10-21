// 评审文件树每行的 `+a −d`：`git diff --numstat -z` 的解析，加上未跟踪文件的行数。
// 已有 hunk 的单文件 diff 能算出同样的数，但文件树要给所有文件显示，逐个取 diff 要起 N 个 git 进程；
// numstat 一次出全部（暂存、未暂存各一次），未跟踪文件直接数行。
import { lstat, readFile, readlink } from "node:fs/promises";
import { GIT_DIFF_MAX_BYTES, type GitChangeStat } from "../../shared/git.ts";
import { resolveInside } from "../ipc/task-file-path.ts";
import { looksBinary } from "./diff.ts";
import { git } from "./exec.ts";
import { requireRepoRoot } from "./repo.ts";
import { statusAt } from "./status.ts";

/**
 * 解析 `git diff --numstat -z`：普通项 `<add>\t<del>\t<path>\0`；重命名/复制项 `<add>\t<del>\t\0<旧路径>\0<新路径>\0`。
 * 二进制文件是 `-\t-`，没有行数，跳过。
 */
export function parseNumstat(text: string, area: "staged" | "unstaged"): GitChangeStat[] {
  const parts = text.split("\0");
  const stats: GitChangeStat[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    if (entry === "") continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(entry);
    if (!match) continue;
    let path = match[3] ?? "";
    if (path === "") {
      i += 2; // 重命名：旧路径、新路径各占一段
      path = parts[i] ?? "";
    }
    if (match[1] === "-" || path === "") continue;
    stats.push({ area, path, added: Number(match[1]), removed: Number(match[2]) });
  }
  return stats;
}

/** 一个新文件的行数：和 `diffOfNewFile` 的分法一致（末尾换行不多算一行，空文件 0 行）。 */
export function countLines(content: Buffer): number {
  if (content.length === 0) return 0;
  let lines = 0;
  for (const byte of content) if (byte === 0x0a) lines++;
  return content[content.length - 1] === 0x0a ? lines : lines + 1;
}

async function untrackedStat(root: string, rel: string): Promise<GitChangeStat | null> {
  const file = resolveInside(root, rel);
  const stat = (content: Buffer): GitChangeStat => ({
    area: "untracked",
    path: rel,
    added: countLines(content),
    removed: 0,
  });
  try {
    const info = await lstat(file);
    // 符号链接不跟随：行数是链接指向文字的行数，和 `getFileDiff` 一致。
    if (info.isSymbolicLink()) return stat(Buffer.from(await readlink(file), "utf8"));
    if (!info.isFile() || info.size > GIT_DIFF_MAX_BYTES) return null;
    const content = await readFile(file);
    return looksBinary(content) ? null : stat(content);
  } catch (error) {
    // 状态和这次读之间文件被删了（agent 正在改）：这一项没有行数，下次刷新会随状态一起消失。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const UNTRACKED_BATCH = 32;

/** 所有改动文件（两侧各算一项）的 `+a −d`；没有行数的（二进制、过大）不在结果里。 */
export async function getChangeStats(cwd: string): Promise<GitChangeStat[]> {
  const root = await requireRepoRoot(cwd);
  const [staged, unstaged, status] = await Promise.all([
    git(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--cached", "-M", "--numstat", "-z"]),
    git(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z"]),
    statusAt(root),
  ]);
  const stats = [
    ...parseNumstat(staged.toString("utf8"), "staged"),
    ...parseNumstat(unstaged.toString("utf8"), "unstaged"),
  ];
  const untracked = status.files.filter((file) => file.unstaged === "untracked");
  for (let at = 0; at < untracked.length; at += UNTRACKED_BATCH) {
    const batch = await Promise.all(
      untracked.slice(at, at + UNTRACKED_BATCH).map((file) => untrackedStat(root, file.path)),
    );
    for (const stat of batch) if (stat !== null) stats.push(stat);
  }
  return stats;
}
