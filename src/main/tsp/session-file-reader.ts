// omp 会话文件（JSONL）的增量读取：只读上次读到的位置之后追加的字节，按行解析成记录交给各个累加器
// （session-usage.ts 的用量、session-extras.ts 的每轮脚注、session-tree-file.ts 的会话树条目）。会话文件动辄几十上百 MB，
// 每次请求结束都整份重读、整份 JSON.parse 会卡住主进程、内存涨几百 MB。只读，不写 ~/.omp。
// 只消费以 `\n` 结尾的完整行：omp 正在写的最后一行留到下次读。omp 会重写文件（如第一行的标题头）：
// 文件变短、或上次读到的位置之前的最后几十字节变了，就清空累加器从头读。
import { open, type FileHandle } from "node:fs/promises";
import { isRecord } from "../../shared/type-guards.ts";

/** 会话文件超过这个大小就不读了（所有读会话文件的地方同一个上限）。 */
export const MAX_SESSION_FILE_BYTES = 256 * 1024 * 1024;

export type SessionFileEntry = Record<string, unknown>;

/** 按文件顺序接收会话文件的每条记录；文件被重写时 reset 后从第一条重新接收。 */
export interface SessionEntryConsumer {
  entry(entry: SessionFileEntry): void;
  reset(): void;
  /** 一行不是合法 JSON（写到一半的最后一行，或文件坏了）；不关心的累加器不实现。 */
  invalid?(): void;
}

const CHUNK_BYTES = 1024 * 1024;
/** 判断文件是否被重写时比对的字节数（上次读到的位置之前）。 */
const ANCHOR_BYTES = 64;
const NEWLINE = 0x0a;
const NO_BYTES = Buffer.alloc(0);
/** SessionReaderCache 默认最多留几个文件的读取器。 */
const CACHED_READERS = 4;

function feedLine(line: string, consumers: readonly SessionEntryConsumer[]): void {
  if (line.trim() === "") return;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // 写到一半的最后一行（omp 正在追加）或损坏的行：一般的累加器跳过，要区分的自己看 invalid。
    for (const consumer of consumers) consumer.invalid?.();
    return;
  }
  if (!isRecord(value)) return;
  for (const consumer of consumers) consumer.entry(value);
}

/** 整段文本按行喂给累加器（summarizeSessionUsage / parseSession / parseSessionEntries 用）；没有换行结尾的最后一行也算。 */
export function feedSessionText(text: string, consumers: readonly SessionEntryConsumer[]): void {
  for (const line of text.split("\n")) feedLine(line, consumers);
}

/** 文件不存在（新会话第一条回复之后才落盘）为 null；别的错误照抛。 */
function openIfExists(file: string): Promise<FileHandle | null> {
  return open(file, "r").catch((error: unknown) => {
    if (isRecord(error) && error["code"] === "ENOENT") return null;
    throw error;
  });
}

/** prev 之后接上 next 的最后 ANCHOR_BYTES 字节（复制一份，不引用读缓冲）。 */
function lastBytes(prev: Buffer, next: Buffer): Buffer {
  if (next.length >= ANCHOR_BYTES) return Buffer.from(next.subarray(next.length - ANCHOR_BYTES));
  const joined = Buffer.concat([prev, next]);
  return joined.length > ANCHOR_BYTES ? Buffer.from(joined.subarray(joined.length - ANCHOR_BYTES)) : joined;
}

/**
 * 读 [start, end) 按 `\n` 切行：完整的行逐行解码交给 onLine（不拼成一整个大字符串；跨块的行先攒字节，多字节字符不会被切开），
 * 每读完一块用 onProgress 报告最后一个 `\n` 之后的位置和它之前的最后 ANCHOR_BYTES 字节。最后一行没有 `\n` 的留到下次。
 * `anchor` 是 start 之前的最后 ANCHOR_BYTES 字节。
 */
async function scanLines(
  handle: FileHandle,
  start: number,
  end: number,
  anchor: Buffer,
  chunk: Buffer,
  onLine: (line: string) => void,
  onProgress: (offset: number, anchor: Buffer) => void,
): Promise<void> {
  let position = start;
  let before = anchor;
  let rest: Buffer[] = [];
  while (position < end) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - position), position);
    // 读的过程中文件变短了：下次 update 会发现并从头读。
    if (bytesRead === 0) break;
    const view = chunk.subarray(0, bytesRead);
    let lineStart = 0;
    let lastNewline = -1;
    for (let newline = view.indexOf(NEWLINE); newline !== -1; newline = view.indexOf(NEWLINE, lineStart)) {
      if (rest.length === 0) {
        onLine(view.toString("utf8", lineStart, newline));
      } else {
        rest.push(view.subarray(lineStart, newline));
        onLine(Buffer.concat(rest).toString("utf8"));
        rest = [];
      }
      lastNewline = newline;
      lineStart = newline + 1;
    }
    if (lastNewline >= 0) onProgress(position + lastNewline + 1, lastBytes(before, view.subarray(0, lastNewline + 1)));
    before = lastBytes(before, view);
    if (lineStart < bytesRead) rest.push(Buffer.from(view.subarray(lineStart)));
    position += bytesRead;
  }
}

/**
 * 一个会话文件的增量读取器：update() 把上次之后追加的完整行交给 consumers。
 * 同一个读取器的 update() 排队执行，不会交错读。文件不存在时当空文件（之前读到过内容就清空累加器）。
 * 超过 MAX_SESSION_FILE_BYTES 抛错。
 */
export class SessionFileReader {
  readonly file: string;
  readonly #consumers: readonly SessionEntryConsumer[];
  readonly #chunkBytes: number;
  /** 最后一个已消费的 `\n` 之后的字节位置。 */
  #offset = 0;
  /** #offset 之前的最后 ANCHOR_BYTES 字节：变了说明文件被重写。 */
  #anchor: Buffer = NO_BYTES;
  #queue: Promise<void> = Promise.resolve();

  /** chunkBytes：每次读的字节数（测试用小块，默认 1 MiB）。 */
  constructor(file: string, consumers: readonly SessionEntryConsumer[], options: { chunkBytes?: number } = {}) {
    this.file = file;
    this.#consumers = consumers;
    this.#chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
  }

  update(): Promise<void> {
    const run = this.#queue.then(() => this.#update());
    // 队列只管先后：这次的错误由 run 交给调用方，不挡住排在后面的 update。
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #update(): Promise<void> {
    const handle = await openIfExists(this.file);
    if (handle === null) {
      this.#reset();
      return;
    }
    try {
      const { size } = await handle.stat();
      if (size > MAX_SESSION_FILE_BYTES) throw new Error(`session file is too large to read (${size} bytes)`);
      if (size < this.#offset || !(await this.#anchorMatches(handle))) this.#reset();
      if (size === this.#offset) return;
      const chunk = Buffer.allocUnsafe(Math.min(this.#chunkBytes, size - this.#offset));
      await scanLines(
        handle,
        this.#offset,
        size,
        this.#anchor,
        chunk,
        (line) => feedLine(line, this.#consumers),
        (offset, anchor) => {
          this.#offset = offset;
          this.#anchor = anchor;
        },
      );
    } finally {
      await handle.close();
    }
  }

  async #anchorMatches(handle: FileHandle): Promise<boolean> {
    const length = this.#anchor.length;
    if (length === 0) return true;
    const current = Buffer.alloc(length);
    const { bytesRead } = await handle.read(current, 0, length, this.#offset - length);
    return bytesRead === length && current.equals(this.#anchor);
  }

  #reset(): void {
    if (this.#offset === 0) return;
    this.#offset = 0;
    this.#anchor = NO_BYTES;
    for (const consumer of this.#consumers) consumer.reset();
  }
}

interface CachedReader<T> {
  reader: SessionFileReader;
  consumers: T;
  /** hold 了还没释放的次数；大于 0 时不会被挤出缓存。 */
  holders: number;
}

/**
 * 按文件缓存的增量读取器（一个文件一个，几个累加器共用一遍读取和 JSON.parse）。同一个文件再查只读新追加的部分，没变就不读。
 * 没被 hold 的最多留 limit 个，最近查过的留着；hold 住的（任务的当前会话文件）一直留到释放。
 * 累加器在读取器里一直更新，调用方拿到后同步取结果，不要跨 await 持有。
 */
export class SessionReaderCache<T extends { readonly [K in keyof T]: SessionEntryConsumer }> {
  readonly #readers = new Map<string, CachedReader<T>>();
  readonly #create: () => T;
  readonly #limit: number;

  constructor(create: () => T, limit = CACHED_READERS) {
    this.#create = create;
    this.#limit = limit;
  }

  async read(file: string): Promise<T> {
    const cached = this.#touch(file);
    await cached.reader.update();
    return cached.consumers;
  }

  /** 占住 file 的读取器，释放之前不会被挤出缓存；返回释放函数（重复调用无效）。 */
  hold(file: string): () => void {
    const cached = this.#touch(file);
    cached.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      cached.holders -= 1;
      this.#evict();
    };
  }

  /** 取（没有就建）file 的读取器，标成最近用过。 */
  #touch(file: string): CachedReader<T> {
    let cached = this.#readers.get(file);
    if (cached) {
      this.#readers.delete(file);
    } else {
      const consumers = this.#create();
      cached = { reader: new SessionFileReader(file, Object.values(consumers)), consumers, holders: 0 };
    }
    this.#readers.set(file, cached);
    this.#evict();
    return cached;
  }

  /** 没被 hold 的超过 limit 个时，从最久没用的开始丢。 */
  #evict(): void {
    let unheld = 0;
    for (const cached of this.#readers.values()) if (cached.holders === 0) unheld += 1;
    for (const [file, cached] of this.#readers) {
      if (unheld <= this.#limit) break;
      if (cached.holders > 0) continue;
      this.#readers.delete(file);
      unheld -= 1;
    }
  }
}
