// omp 会话文件的只读索引。omp 没有"列出会话"的 RPC，只能读它的存储格式（omp 文档 session.md "File Format"，18.12.0）：
//   <agentDir>/sessions/<编码后的 cwd>/<时间戳>_<id>.jsonl
//   文件开头是 256 字节定宽的 {"type":"title",...} 标题槽，随后是 {"type":"session",...} 头，再往后是条目；
//   旧版文件没有标题槽，直接从头开始。
// 本模块只读：从不写 ~/.omp，只读每个文件的前缀，不解析正文。格式不是协议契约，升级后可能变，所以解析不了的文件
// 计数跳过（skipped）而不是抛错，列表其余部分照常工作。细节见 docs/architecture/session-history.md。
import { open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRecord } from "../../shared/type-guards.ts";

/** 第一次读取的前缀字节数：标题槽 256 + 头 + 开头的若干条目，通常够找到第一条用户消息。 */
const PREFIX_BYTES = 32 * 1024;
/** 没有标题、前缀里又没有用户消息时（首条消息很长，比如带图片）再放宽到这个上限。 */
const EXTENDED_PREFIX_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 200;
const SCAN_CONCURRENCY = 16;

export interface IndexedSession {
  /** 会话头里的 id。 */
  id: string;
  /** 会话文件的绝对路径。 */
  file: string;
  /** 会话头里的 cwd：启动 omp、归属项目都以它为准（不自己推算桶目录名）。 */
  cwd: string;
  /** 标题槽里的当前标题，其次是头里的 title；都没有为 null。 */
  title: string | null;
  /** 第一条用户消息的首行。 */
  firstPrompt: string | null;
  modifiedAt: number;
  size: number;
}

export interface SessionScan {
  /** 按修改时间从新到旧。 */
  sessions: IndexedSession[];
  /** 读不了或格式不认识的文件数（损坏、不是 omp 会话、空文件……）。 */
  skipped: number;
}

/** omp 的 agent 目录：PI_CODING_AGENT_DIR 覆盖默认 profile；否则 <home>/<PI_CONFIG_DIR 或 .omp>/agent。 */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const override = env["PI_CODING_AGENT_DIR"];
  if (override !== undefined && override !== "") return path.resolve(override);
  const configDirName = env["PI_CONFIG_DIR"];
  return path.join(home, configDirName !== undefined && configDirName !== "" ? configDirName : ".omp", "agent");
}

export function resolveSessionsDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(resolveAgentDir(env, home), "sessions");
}

/** 路径比较用的键：Windows 文件系统不区分大小写，且可能混用 / 和 \。 */
export function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 标题和提示文本：只留第一个非空行，去掉控制字符，限长。 */
function sanitizeText(value: string): string | null {
  for (const line of value.split(/\r?\n/)) {
    const cleaned = line
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned !== "") return cleaned.length > MAX_TEXT_CHARS ? `${cleaned.slice(0, MAX_TEXT_CHARS)}…` : cleaned;
  }
  return null;
}

function userMessageText(entry: Record<string, unknown>): string | null {
  const message = entry["message"];
  if (!isRecord(message) || message["role"] !== "user") return null;
  const content = message["content"];
  if (typeof content === "string") return sanitizeText(content);
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") {
      const text = sanitizeText(part["text"]);
      if (text !== null) return text;
    }
  }
  return null;
}

export interface ParsedHead {
  id: string;
  cwd: string;
  title: string | null;
  firstPrompt: string | null;
}

/**
 * 解析文件前缀。`truncated` 表示 text 只是文件的开头一段：最后一行可能被截断，直接丢掉。
 * 找不到合法的会话头（id 和 cwd 都是非空字符串）返回 null。
 */
export function parseSessionPrefix(text: string, truncated: boolean): ParsedHead | null {
  const lines = text.split("\n");
  if (truncated) lines.pop();

  let slotTitle: string | null = null;
  let header: Record<string, unknown> | null = null;
  let firstPrompt: string | null = null;

  for (const line of lines) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // 头之前的损坏行说明这不是我们认识的文件；头之后的损坏行（被截断的长消息等）只是跳过。
      if (header === null) return null;
      continue;
    }
    if (!isRecord(entry)) continue;
    if (header === null) {
      if (entry["type"] === "title") {
        if (typeof entry["title"] === "string") slotTitle = sanitizeText(entry["title"]);
        continue;
      }
      if (entry["type"] !== "session") return null;
      header = entry;
      continue;
    }
    if (entry["type"] === "message" && firstPrompt === null) firstPrompt = userMessageText(entry);
    if (firstPrompt !== null) break;
  }

  if (header === null) return null;
  const id = header["id"];
  const cwd = header["cwd"];
  if (typeof id !== "string" || id === "" || typeof cwd !== "string" || cwd === "") return null;
  const headerTitle = typeof header["title"] === "string" ? sanitizeText(header["title"]) : null;
  return { id, cwd, title: slotTitle ?? headerTitle, firstPrompt };
}

/** 读文件前 maxBytes 字节；返回文本和"文件是否比读到的更长"。 */
async function readPrefix(file: string, size: number, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const length = Math.min(size, maxBytes);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return { text: buffer.toString("utf8", 0, bytesRead), truncated: size > bytesRead };
  } finally {
    await handle.close();
  }
}

/** 读一个会话文件的头信息；不是会话文件时返回 null。 */
export async function readSessionHead(file: string, size: number): Promise<ParsedHead | null> {
  const first = await readPrefix(file, size, PREFIX_BYTES);
  const head = parseSessionPrefix(first.text, first.truncated);
  if (head === null || !first.truncated || head.title !== null || head.firstPrompt !== null) return head;
  const extended = await readPrefix(file, size, EXTENDED_PREFIX_BYTES);
  return parseSessionPrefix(extended.text, extended.truncated);
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  /** null = 这个文件不是可识别的会话（缓存下来，避免每次重读）。 */
  session: IndexedSession | null;
}

export class SessionIndex {
  readonly sessionsDir: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(sessionsDir: string = resolveSessionsDir()) {
    this.sessionsDir = sessionsDir;
  }

  /** 扫描所有桶目录的顶层 *.jsonl。按 (路径, mtime, 大小) 缓存，没变的文件不重读。目录不存在时返回空列表。 */
  async scan(): Promise<SessionScan> {
    const files = await this.listFiles();
    const seen = new Set(files.map((item) => item.file));
    for (const cached of this.cache.keys()) {
      if (!seen.has(cached)) this.cache.delete(cached);
    }

    const entries = await mapWithConcurrency(files, SCAN_CONCURRENCY, (item) => this.load(item.file));
    const sessions: IndexedSession[] = [];
    let skipped = 0;
    for (const entry of entries) {
      if (entry === null || entry.session === null) skipped += 1;
      else sessions.push(entry.session);
    }
    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { sessions, skipped };
  }

  /** 会话头 id 对应的会话；同一个 id 有多个文件时取最新的。 */
  async findById(id: string): Promise<IndexedSession | null> {
    const { sessions } = await this.scan();
    return sessions.find((session) => session.id === id) ?? null;
  }

  private async listFiles(): Promise<{ file: string }[]> {
    let buckets;
    try {
      buckets = await readdir(this.sessionsDir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const perBucket = await mapWithConcurrency(
      buckets.filter((bucket) => bucket.isDirectory()),
      SCAN_CONCURRENCY,
      async (bucket) => {
        const dir = path.join(this.sessionsDir, bucket.name);
        try {
          const children = await readdir(dir, { withFileTypes: true });
          return children
            .filter((child) => child.isFile() && child.name.endsWith(".jsonl"))
            .map((child) => ({ file: path.join(dir, child.name) }));
        } catch (error) {
          if (isMissing(error)) return [];
          throw error;
        }
      },
    );
    return perBucket.flat();
  }

  /** 读一个文件的索引项；扫描期间文件被删（omp 正在整理）返回 null。 */
  private async load(file: string): Promise<CacheEntry | null> {
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const cached = this.cache.get(file);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;

    let head: ParsedHead | null;
    try {
      head = await readSessionHead(file, info.size);
    } catch (error) {
      if (isMissing(error)) return null;
      // 被占用、权限等：这一次跳过，不缓存，下次重试。
      if (isTransient(error)) return { mtimeMs: info.mtimeMs, size: info.size, session: null };
      throw error;
    }
    const entry: CacheEntry = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      session:
        head === null
          ? null
          : {
              id: head.id,
              file,
              cwd: head.cwd,
              title: head.title,
              firstPrompt: head.firstPrompt,
              modifiedAt: info.mtimeMs,
              size: info.size,
            },
    };
    this.cache.set(file, entry);
    return entry;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function isTransient(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
