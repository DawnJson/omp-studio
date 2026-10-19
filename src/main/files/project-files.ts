// `@` 文件引用的补全数据：列出任务目录（或新任务草稿的项目目录）里的文件，只返回相对路径。
// 优先 `git ls-files -co --exclude-standard`（尊重 .gitignore），不是仓库或 git 不可用时退回有界的目录遍历。
import { readdir } from "node:fs/promises";
import path from "node:path";
import { gitRaw } from "../git/exec.ts";

/** 每个目录最多缓存这么多条路径；再多的文件靠输入更长的查询词也找不到（有意的上限）。 */
export const MAX_INDEXED_FILES = 10_000;
/** 一次最多返回给界面的条数。 */
export const MAX_RESULTS = 20;
export const MAX_QUERY_CHARS = 256;
const MAX_WALK_DIRS = 5_000;
const CACHE_TTL_MS = 10_000;
const MAX_CACHED_DIRS = 8;
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

/**
 * 查询词的形状校验：渲染进程传来的不可信。查询词只用来匹配相对路径，但它是用户在 `@` 后面敲的路径，
 * 所以绝对路径和 `..` 段直接拒绝，不假装它们"没匹配到"。返回统一成 `/` 分隔的小写前的原文。
 */
export function parseFileQuery(value: unknown): string {
  if (typeof value !== "string") throw new Error("query must be a string");
  if (value.length > MAX_QUERY_CHARS) throw new Error("query is too long");
  if (value.includes("\0")) throw new Error("invalid query");
  const query = value.replaceAll("\\", "/");
  if (query.startsWith("/") || /^[a-zA-Z]:/.test(query))
    throw new Error("query must be relative to the project directory");
  if (query.split("/").includes("..")) throw new Error("query escapes the project directory");
  return query;
}

/** 越靠前越好；null = 不匹配。 */
function score(file: string, query: string): number | null {
  const lower = file.toLowerCase();
  if (lower.startsWith(query)) return 0;
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base.startsWith(query)) return 1;
  if (base.includes(query)) return 2;
  if (lower.includes(query)) return 3;
  // 子序列（fuzzy）：query 的字符按顺序出现在路径里。
  let at = 0;
  for (const char of query) {
    at = lower.indexOf(char, at);
    if (at === -1) return null;
    at += 1;
  }
  return 4;
}

/** 在已索引的相对路径里匹配：前缀 > 文件名前缀 > 文件名包含 > 路径包含 > 子序列；同档里短的、浅的在前。 */
export function matchProjectFiles(files: readonly string[], query: string, limit = MAX_RESULTS): string[] {
  const q = query.toLowerCase();
  const scored: { file: string; rank: number; depth: number }[] = [];
  for (const file of files) {
    const rank = q === "" ? 0 : score(file, q);
    if (rank === null) continue;
    scored.push({ file, rank, depth: file.split("/").length });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.depth - b.depth ||
      a.file.length - b.file.length ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  return scored.slice(0, limit).map((entry) => entry.file);
}

/** 路径里有空白的不收：`@a b.ts` 会在空格处断开，补全出来的引用是错的。 */
function usable(file: string): boolean {
  return file !== "" && !/\s/.test(file);
}

async function gitFiles(cwd: string, cap: number): Promise<string[] | null> {
  try {
    const result = await gitRaw(cwd, ["ls-files", "-co", "--exclude-standard", "-z"], {
      maxBuffer: 64 * 1024 * 1024,
      timeoutMs: 10_000,
    });
    if (result.code !== 0) return null;
    const files = new Set<string>();
    for (const entry of result.stdout.toString("utf8").split("\0")) {
      if (!usable(entry)) continue;
      files.add(entry);
      if (files.size >= cap) break;
    }
    return [...files];
  } catch {
    // git 不在 PATH 上、输出过大、超时：都退回遍历。
    return null;
  }
}

/** 广度优先，浅层文件先收满上限；不跟随符号链接（不会走出目录），跳过 node_modules 和 .git。 */
export async function walkFiles(root: string, cap = MAX_INDEXED_FILES): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [""];
  let visited = 0;
  while (queue.length > 0 && files.length < cap && visited < MAX_WALK_DIRS) {
    const rel = queue.shift() as string;
    visited += 1;
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) queue.push(child);
      } else if (entry.isFile() && usable(child)) {
        files.push(child);
        if (files.length >= cap) break;
      }
    }
  }
  return files;
}

/** 按目录缓存索引几秒钟：连续敲 `@` 后面的字符不会反复跑 git。 */
export class ProjectFileIndex {
  readonly #cache = new Map<string, { at: number; files: Promise<string[]> }>();
  readonly #now: () => number;
  readonly #load: (cwd: string, cap: number) => Promise<string[]>;

  constructor(
    load: (cwd: string, cap: number) => Promise<string[]> = async (cwd, cap) =>
      (await gitFiles(cwd, cap)) ?? (await walkFiles(cwd, cap)),
    now: () => number = Date.now,
  ) {
    this.#load = load;
    this.#now = now;
  }

  list(cwd: string): Promise<string[]> {
    const hit = this.#cache.get(cwd);
    if (hit && this.#now() - hit.at < CACHE_TTL_MS) return hit.files;
    const files = this.#load(cwd, MAX_INDEXED_FILES).then((all) => all.slice(0, MAX_INDEXED_FILES));
    this.#cache.delete(cwd);
    this.#cache.set(cwd, { at: this.#now(), files });
    files.catch(() => {
      if (this.#cache.get(cwd)?.files === files) this.#cache.delete(cwd);
    });
    while (this.#cache.size > MAX_CACHED_DIRS) {
      const oldest = this.#cache.keys().next();
      if (oldest.done) break;
      this.#cache.delete(oldest.value);
    }
    return files;
  }

  async search(cwd: string, query: string): Promise<string[]> {
    return matchProjectFiles(await this.list(cwd), query);
  }
}
