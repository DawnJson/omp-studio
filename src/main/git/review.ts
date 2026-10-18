// 评审：文件 diff、暂存/取消暂存/丢弃（整文件和单个 hunk）。
// 丢弃不问确认：确认由界面做（阶段 3 的约定）。所有路径相对仓库根，先做词法校验；
// 要读写磁盘的（未跟踪文件的 diff 和丢弃）还要求它确实出现在 git status 的未跟踪列表里。
import { lstat, readFile, readlink, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  GIT_DIFF_MAX_BYTES,
  type GitDiffArea,
  type GitFileChange,
  type GitFileDiff,
  type GitHunkRef,
} from "../../shared/git.ts";
import { resolveInside } from "../ipc/task-file-path.ts";
import { buildHunkPatch, diffOfNewFile, looksBinary, splitRawDiff, toFileDiff, type RawDiff } from "./diff.ts";
import { git, OutputTooLargeError } from "./exec.ts";
import { hasCommits, requireRepoRoot } from "./repo.ts";
import { statusAt } from "./status.ts";

/** 校验渲染进程给的路径：相对、不越界、不碰 .git。返回仓库根下的正斜杠路径。 */
export function checkRepoPath(root: string, rel: string): string {
  const resolved = resolveInside(root, rel);
  const normalized = path.relative(root, resolved).split(path.sep).join("/");
  // Windows/macOS 的文件系统不区分大小写：`.GIT/config` 也是 .git 内部。
  const lower = normalized.toLowerCase();
  if (lower === ".git" || lower.startsWith(".git/")) throw new Error("path is inside .git");
  return normalized;
}

async function findEntry(root: string, rel: string): Promise<GitFileChange> {
  const entry = (await statusAt(root)).files.find((file) => file.path === rel);
  if (!entry) throw new Error(`${rel} has no changes`);
  return entry;
}

const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-U3",
];

/** 取已跟踪文件一侧的原始 diff；输出超过上限返回 "too_large"。 */
async function readTrackedDiff(
  root: string,
  entry: GitFileChange,
  area: "staged" | "unstaged",
): Promise<Buffer | "too_large"> {
  const args =
    area === "staged"
      ? [...DIFF_FLAGS, "--cached", "-M", "--", ...(entry.oldPath === null ? [] : [entry.oldPath]), entry.path]
      : [...DIFF_FLAGS, "--", entry.path];
  try {
    return await git(root, args, { maxBuffer: GIT_DIFF_MAX_BYTES });
  } catch (error) {
    if (error instanceof OutputTooLargeError) return "too_large";
    throw error;
  }
}

async function untrackedDiff(root: string, rel: string): Promise<GitFileDiff> {
  const file = resolveInside(root, rel);
  const info = await lstat(file);
  // 符号链接不跟随（链接目标可能在仓库外）：显示链接指向的文字，和 git 的做法一致。
  if (info.isSymbolicLink()) return diffOfNewFile(Buffer.from(await readlink(file), "utf8"));
  if (!info.isFile()) throw new Error(`${rel} is not a regular file`);
  if (info.size > GIT_DIFF_MAX_BYTES) return { kind: "too_large" };
  const content = await readFile(file);
  return looksBinary(content) ? { kind: "binary" } : diffOfNewFile(content);
}

export async function getFileDiff(cwd: string, rel: string, area: GitDiffArea): Promise<GitFileDiff> {
  const root = await requireRepoRoot(cwd);
  const file = checkRepoPath(root, rel);
  const entry = await findEntry(root, file);
  if (area === "untracked") {
    if (entry.unstaged !== "untracked") throw new Error(`${file} is tracked`);
    return untrackedDiff(root, file);
  }
  const raw = await readTrackedDiff(root, entry, area);
  if (raw === "too_large") return { kind: "too_large" };
  return toFileDiff(splitRawDiff(raw));
}

// ───────── 文件级 ─────────

export async function stageFile(cwd: string, rel: string): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const file = checkRepoPath(root, rel);
  const entry = await findEntry(root, file);
  if (entry.staged === "conflicted") throw new Error("resolve the conflict in the editor first, then stage the file");
  await git(root, ["add", "--", file]);
}

export async function unstageFile(cwd: string, rel: string): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const file = checkRepoPath(root, rel);
  const entry = await findEntry(root, file);
  const paths = entry.oldPath === null ? [file] : [entry.oldPath, file];
  // 新仓库还没有 HEAD，`restore --staged` 不可用。
  if (await hasCommits(root)) await git(root, ["restore", "--staged", "--", ...paths]);
  else await git(root, ["rm", "--cached", "-q", "--", ...paths]);
}

/** 把文件的所有改动（暂存的和没暂存的）退回 HEAD；未跟踪的文件直接删除。 */
export async function discardFile(cwd: string, rel: string): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const file = checkRepoPath(root, rel);
  const entry = await findEntry(root, file);
  if (entry.unstaged === "untracked") {
    const target = resolveInside(root, file);
    // 父目录经符号链接解析后必须仍在仓库内（目录符号链接可能把路径带出仓库）；
    // 目标本身不解析：未跟踪的符号链接只删链接，不动它指向的文件。
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(path.dirname(target))]);
    const fromRoot = path.relative(realRoot, realParent);
    if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) throw new Error("path escapes the repository");
    if ((await lstat(target)).isDirectory()) throw new Error(`${file} is a directory`);
    await rm(target, { force: true });
    return;
  }
  if (entry.staged === "conflicted") throw new Error("resolve the conflict first");
  const inHead = await hasCommits(root);
  if (!inHead || entry.staged === "added" || entry.staged === "copied") {
    await git(root, ["rm", "-f", "-q", "--", file]);
    return;
  }
  if (entry.staged === "renamed" && entry.oldPath !== null) {
    await git(root, ["rm", "-f", "-q", "--", file]);
    await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", entry.oldPath]);
    return;
  }
  await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", file]);
}

// ───────── hunk 级 ─────────

/** 重新取 diff 并确认第 index 个 hunk 还是界面看到的那个；diff 变过就拒绝，免得改错地方。 */
async function loadHunkPatch(root: string, rel: string, area: "staged" | "unstaged", ref: GitHunkRef): Promise<Buffer> {
  const file = checkRepoPath(root, rel);
  const entry = await findEntry(root, file);
  if (entry.unstaged === "untracked") throw new Error("untracked files have no hunks; stage the whole file");
  if (entry.staged === "conflicted") throw new Error("resolve the conflict first");
  const rawBuffer = await readTrackedDiff(root, entry, area);
  if (rawBuffer === "too_large") throw new Error("the diff is too large for hunk operations");
  const raw: RawDiff | null = splitRawDiff(rawBuffer);
  if (raw === null) throw new Error("binary files have no hunks");
  const hunk = raw.hunks[ref.index];
  const header =
    hunk === undefined ? undefined : Buffer.from(hunk.slice(0, hunk.indexOf("\n")), "latin1").toString("utf8");
  if (header !== ref.header) throw new Error("the file changed since the diff was loaded; refresh and try again");
  return buildHunkPatch(raw, ref.index);
}

export async function stageHunk(cwd: string, rel: string, ref: GitHunkRef): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const patch = await loadHunkPatch(root, rel, "unstaged", ref);
  await git(root, ["apply", "--cached", "--whitespace=nowarn", "-"], { input: patch });
}

export async function unstageHunk(cwd: string, rel: string, ref: GitHunkRef): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const patch = await loadHunkPatch(root, rel, "staged", ref);
  await git(root, ["apply", "--cached", "-R", "--whitespace=nowarn", "-"], { input: patch });
}

/** 丢弃一个没暂存的 hunk（工作区退回暂存区）。已暂存的 hunk 要先在界面里取消暂存，这里不处理。 */
export async function discardHunk(cwd: string, rel: string, ref: GitHunkRef): Promise<void> {
  const root = await requireRepoRoot(cwd);
  const patch = await loadHunkPatch(root, rel, "unstaged", ref);
  await git(root, ["apply", "-R", "--whitespace=nowarn", "-"], { input: patch });
}
