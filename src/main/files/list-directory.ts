// 右侧文件面板的文件树：每次只列一层目录。路径相对根目录，词法和符号链接两道校验都必须落在根内。
// 目录在前、文件在后，同类按名字（数字按数值）排序；`.git` 不列出；被 .gitignore 忽略的条目照列，用 `git check-ignore` 标成 ignored，
// 界面把它们调暗（node_modules、dist 看得见但不抢眼）。不在仓库里或 git 不可用时没有 ignored 标记。
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DirEntry, DirListing } from "../../shared/ipc.ts";
import { runCommand } from "../git/exec.ts";
import { resolveInside } from "../ipc/task-file-path.ts";

/** 一层最多返回这么多条；超过时 truncated = true（排序在截断之前，所以留下的是排序靠前的）。 */
export const MAX_DIR_ENTRIES = 20_000;
const HIDDEN_DIR = ".git";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** 目录项的类型：符号链接解析到根内才列（按目标的类型），断链和指向根外的不列。 */
async function classify(
  realRoot: string,
  dir: string,
  entry: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean },
): Promise<DirEntry["kind"] | null> {
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return null;
  try {
    const real = await realpath(path.join(dir, entry.name));
    if (!inside(realRoot, real)) return null;
    return (await stat(real)).isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
}

/** 在 dir 里跑 `git check-ignore`，返回被忽略的名字。退出码 0 = 有被忽略的，1 = 都没有，128 = 不在仓库里；其余当作没有。 */
async function ignoredNames(dir: string, entries: readonly DirEntry[]): Promise<Set<string>> {
  if (entries.length === 0) return new Set();
  try {
    // 不走 gitRaw：它带 --literal-pathspecs，check-ignore 不接受（pathspec magic not supported）。
    const result = await runCommand("git", ["check-ignore", "-z", "--stdin"], {
      cwd: dir,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      input: entries.map((entry) => entry.name).join("\0") + "\0",
      maxBuffer: 16 * 1024 * 1024,
      timeoutMs: 5_000,
    });
    if (result.code !== 0) return new Set();
    return new Set(result.stdout.toString("utf8").split("\0").filter(Boolean));
  } catch {
    // git 不在 PATH 上、超时、输出过大：不标记。
    return new Set();
  }
}

/**
 * 列 root 下 relDir 这一层（"" = 根）。relDir 含 `..` 越界、绝对路径、解析符号链接后落在根外都抛错；
 * 目录不存在（或是个文件）返回空列表，不抛错——界面上的树可能比磁盘旧。
 */
export async function listDirectory(root: string, relDir: string, limit = MAX_DIR_ENTRIES): Promise<DirListing> {
  const normalized = relDir === "" ? "" : path.normalize(relDir);
  const lexical = normalized === "" ? root : resolveInside(root, normalized);
  let realRoot: string;
  let dir: string;
  try {
    realRoot = await realpath(root);
    dir = await realpath(lexical);
  } catch (error) {
    if (isMissing(error)) return { entries: [], truncated: false };
    throw error;
  }
  if (!inside(realRoot, dir)) throw new Error("path escapes the task directory");
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { entries: [], truncated: false };
    throw error;
  }
  const kinds = await Promise.all(
    dirents.map((dirent) => (dirent.name === HIDDEN_DIR ? null : classify(realRoot, dir, dirent))),
  );
  const entries: DirEntry[] = [];
  dirents.forEach((dirent, index) => {
    const kind = kinds[index];
    if (kind) entries.push({ name: dirent.name, kind, ignored: false });
  });
  entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1) || collator.compare(a.name, b.name));
  const truncated = entries.length > limit;
  if (truncated) entries.length = limit;
  const ignored = await ignoredNames(dir, entries);
  for (const entry of entries) entry.ignored = ignored.has(entry.name);
  return { entries, truncated };
}
