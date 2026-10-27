// `@` 文件引用的补全数据：列出任务目录（或新任务草稿的项目目录）里的文件，只返回相对路径。
// 优先 `git ls-files -co --exclude-standard`（尊重 .gitignore），不是仓库或 git 不可用时退回有界的目录遍历。
import { readdir } from "node:fs/promises";
import path from "node:path";
import { gitRaw } from "../git/exec.ts";

/** 每个目录最多缓存这么多条路径；再多的文件靠输入更长的查询词也找不到（有意的上限）。 */
export const MAX_INDEXED_FILES = 10_000;
/** 一次最多返回给界面的条数。 */
export const MAX_RESULTS = 20;
const MAX_QUERY_CHARS = 256;
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

/** 缓存里的一条路径：小写形式、文件名起点和层级在建索引时算一次，查询时不再重复算。 */
export interface IndexedFile {
  path: string;
  lower: string;
  baseStart: number;
  depth: number;
}

export function indexFiles(files: readonly string[]): IndexedFile[] {
  return files.map((file) => {
    const lower = file.toLowerCase();
    let depth = 1;
    for (let i = file.indexOf("/"); i !== -1; i = file.indexOf("/", i + 1)) depth += 1;
    return { path: file, lower, baseStart: lower.lastIndexOf("/") + 1, depth };
  });
}

/** 越靠前越好；null = 不匹配。 */
function score(file: IndexedFile, query: string): number | null {
  const { lower } = file;
  if (lower.startsWith(query)) return 0;
  const baseAt = lower.indexOf(query, file.baseStart);
  if (baseAt === file.baseStart) return 1;
  if (baseAt !== -1) return 2;
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

interface Scored {
  file: IndexedFile;
  rank: number;
}

function compareScored(a: Scored, b: Scored): number {
  return (
    a.rank - b.rank ||
    a.file.depth - b.file.depth ||
    a.file.path.length - b.file.path.length ||
    (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0)
  );
}

/** 在已索引的相对路径里匹配：前缀 > 文件名前缀 > 文件名包含 > 路径包含 > 子序列；同档里短的、浅的在前。 */
export function matchProjectFiles(files: readonly IndexedFile[], query: string, limit = MAX_RESULTS): string[] {
  const q = query.toLowerCase();
  // 只保留最好的 limit 条（有序），不对全部匹配项排序。
  if (limit <= 0) return [];
  const top: Scored[] = [];
  for (const file of files) {
    const rank = q === "" ? 0 : score(file, q);
    if (rank === null) continue;
    const entry = { file, rank };
    if (top.length === limit && compareScored(entry, top[limit - 1]!) >= 0) continue;
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareScored(top[mid]!, entry) <= 0) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, entry);
    if (top.length > limit) top.pop();
  }
  return top.map((entry) => entry.file.path);
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
  readonly #cache = new Map<string, { at: number; files: Promise<IndexedFile[]> }>();
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

  list(cwd: string): Promise<IndexedFile[]> {
    const hit = this.#cache.get(cwd);
    if (hit && this.#now() - hit.at < CACHE_TTL_MS) return hit.files;
    const files = this.#load(cwd, MAX_INDEXED_FILES).then((all) => indexFiles(all.slice(0, MAX_INDEXED_FILES)));
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
