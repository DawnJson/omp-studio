/**
 * HDiffPatch 单压缩流补丁（HDIFFSF20）应用端的 TypeScript 移植。
 *
 * 移植自 HDiffPatch v5.1.3（commit 912dcc82a65aad603d11ce64970d378852773a44，MIT 许可，
 * https://github.com/sisong/HDiffPatch）的 libHDiffPatch/HPatch/patch.c：
 *   - hpatch_unpackUIntWithTag            -> unpackUInt
 *   - getSingleCompressedDiffInfo         -> parseHeader
 *   - _patch_single_compressed_diff_mt    -> applySingleStreamPatch（流选择、压缩段边界）
 *   - _patch_single_stream_loop           -> 主循环
 *   - sspatch_covers_nextCover            -> nextCover
 *   - _rle0_decoder_add / _patch_add_old_with_rle0 -> Rle0Decoder / 就地加差值
 *
 * 补丁文件布局：头（"HDIFFSF20&<压缩类型>\0" + 6 个 varint）+ 数据段（zstd 帧或原始字节）。
 * 数据段解压后是若干个 step：[coverBytes, rleBytes 两个 varint][covers 缓冲 + rle0 缓冲]
 * 后面跟着各 cover 之间的新增字节（直接复制到输出）。
 *
 * 仅支持压缩类型为空或 "zstd"；其余（lzma、zlib、bz2……）抛 HPatchFormatError。
 * 不支持：多线程、校验和扩展（HDIFF 的 `&checksum` 变体属于另一个魔数，会被当作未知魔数拒绝）。
 */
import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream";
import type { Readable } from "node:stream";
import { constants as zlibConstants, createZstdDecompress } from "node:zlib";

/** 补丁格式（魔数 / 压缩类型）不被本实现支持；调用方应退回全量下载。 */
class HPatchFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HPatchFormatError";
  }
}

const kMagic = "HDIFFSF20";
// 与 patch.c 的 _kStepMemSizeSafeLimit 一致：防止畸形头触发巨额分配
const kStepMemSizeSafeLimit = 4 * (1 << 20);
// 输出缓冲：1 MiB 让写盘系统调用足够少，同时旧文件随机读也直接落在这块缓冲里
const kOutCacheSize = 1 << 20;
// 补丁流读取块；解压输出块越大，Node 与 libzstd 之间的往返越少
const kStreamChunk = 256 * 1024;
// 头部上限：类型串 + 6 个 varint 远小于此
const kHeadReadSize = 512;

function corrupt(why: string): Error {
  return new Error(`HDiffPatch 补丁数据损坏：${why}`);
}

/**
 * 读 varint（高位为续接标记，tagBit 个最高位留给外部标签）。
 * 位置用数字而非 BigInt：偏移/长度都远小于 2^53，超出视为损坏。
 */
function unpackUInt(buf: Uint8Array, cur: { p: number }, end: number, tagBit: number): number {
  let p = cur.p;
  if (p >= end) throw corrupt("varint 越界");
  let code = buf[p++]!;
  const dataBits = 7 - tagBit;
  let value = code & ((1 << dataBits) - 1);
  if ((code & (1 << dataBits)) !== 0) {
    do {
      if (value > Number.MAX_SAFE_INTEGER / 128) throw corrupt("varint 超出 2^53");
      if (p >= end) throw corrupt("varint 越界");
      code = buf[p++]!;
      value = value * 128 + (code & 0x7f);
    } while ((code & 0x80) !== 0);
  }
  cur.p = p;
  return value;
}

interface DiffInfo {
  compressType: string;
  newDataSize: number;
  oldDataSize: number;
  coverCount: number;
  stepMemSize: number;
  uncompressedSize: number;
  compressedSize: number;
  /** 数据段在补丁文件中的起始偏移 */
  diffDataPos: number;
}

function parseHeader(head: Buffer): DiffInfo {
  const end = head.length;
  const cur = { p: 0 };
  const readType = (endTag: number): string => {
    const start = cur.p;
    const i = head.indexOf(endTag, start);
    if (i < 0) throw new HPatchFormatError("不是 HDiffPatch 单流补丁（头部缺少分隔符）");
    cur.p = i + 1;
    return head.toString("latin1", start, i);
  };
  if (readType(0x26 /* '&' */) !== kMagic) {
    throw new HPatchFormatError("不是 HDiffPatch 单流补丁（魔数不是 HDIFFSF20）");
  }
  const compressType = readType(0);
  if (compressType !== "" && compressType !== "zstd") {
    throw new HPatchFormatError(`不支持的补丁压缩类型：${compressType}`);
  }
  const newDataSize = unpackUInt(head, cur, end, 0);
  const oldDataSize = unpackUInt(head, cur, end, 0);
  const coverCount = unpackUInt(head, cur, end, 0);
  const stepMemSize = unpackUInt(head, cur, end, 0);
  const uncompressedSize = unpackUInt(head, cur, end, 0);
  const compressedSize = unpackUInt(head, cur, end, 0);
  if (compressedSize > uncompressedSize) throw corrupt("compressedSize 大于 uncompressedSize");
  if (stepMemSize > newDataSize + kStepMemSizeSafeLimit) throw corrupt("stepMemSize 过大");
  if (stepMemSize > uncompressedSize + kStepMemSizeSafeLimit) throw corrupt("stepMemSize 过大");
  // 类型为 zstd 但 compressedSize==0 时，原实现按未压缩处理（decompressPlugin 置空）
  return {
    compressType,
    newDataSize,
    oldDataSize,
    coverCount,
    stepMemSize,
    uncompressedSize,
    compressedSize,
    diffDataPos: cur.p,
  };
}

/** 对补丁数据流（已解压）的顺序读取器：按需拉取块，不整体缓冲。 */
class DiffReader {
  private readonly iter: AsyncIterator<Buffer>;
  private chunk: Buffer = Buffer.alloc(0);
  private pos = 0;
  private consumed = 0;

  private readonly totalSize: number;

  constructor(stream: Readable, totalSize: number) {
    this.totalSize = totalSize;
    this.iter = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(): Promise<boolean> {
    for (;;) {
      const r = await this.iter.next();
      if (r.done) return false;
      const c = r.value;
      if (c.length === 0) continue;
      this.consumed += c.length;
      if (this.consumed > this.totalSize) throw corrupt("补丁数据流长度超过头中声明的 uncompressedSize");
      this.chunk = c;
      this.pos = 0;
      return true;
    }
  }

  private async need(): Promise<void> {
    if (this.pos >= this.chunk.length && !(await this.fill())) throw corrupt("补丁数据流意外结束");
  }

  /** 只用于每个 step 开头的两个 varint，数量极少，逐字节 await 足够。 */
  async readUInt(): Promise<number> {
    let value = 0;
    for (let first = true; ; first = false) {
      await this.need();
      const code = this.chunk[this.pos++]!;
      if (first) {
        value = code & 0x7f;
      } else {
        if (value > Number.MAX_SAFE_INTEGER / 128) throw corrupt("varint 超出 2^53");
        value = value * 128 + (code & 0x7f);
      }
      if ((code & 0x80) === 0) return value;
    }
  }

  async readInto(dst: Buffer, length: number): Promise<void> {
    let off = 0;
    while (off < length) {
      await this.need();
      const take = Math.min(length - off, this.chunk.length - this.pos);
      this.chunk.copy(dst, off, this.pos, this.pos + take);
      this.pos += take;
      off += take;
    }
  }

  async copyTo(out: OutWriter, length: number): Promise<void> {
    while (length > 0) {
      await this.need();
      const take = Math.min(length, this.chunk.length - this.pos);
      await out.write(this.chunk, this.pos, take);
      this.pos += take;
      length -= take;
    }
  }

  /** 数据是否恰好读完（对应 _TStreamCacheClip_isFinish）。 */
  async isFinish(): Promise<boolean> {
    if (this.pos < this.chunk.length) return false;
    if (await this.fill()) return false;
    return this.consumed === this.totalSize;
  }
}

/** 顺序写输出文件的带缓冲写入器（对应 _TOutStreamCache）。 */
class OutWriter {
  readonly cache = Buffer.allocUnsafe(kOutCacheSize);
  private fill = 0;
  private filePos = 0;
  /** 已交给本写入器的总字节数 */
  written = 0;

  private readonly fh: FileHandle;
  private readonly newDataSize: number;

  constructor(fh: FileHandle, newDataSize: number) {
    this.fh = fh;
    this.newDataSize = newDataSize;
  }

  private async flushCache(): Promise<void> {
    if (this.fill === 0) return;
    await this.writeAll(this.cache, 0, this.fill);
    this.fill = 0;
  }

  private async writeAll(buf: Buffer, off: number, len: number): Promise<void> {
    while (len > 0) {
      const { bytesWritten } = await this.fh.write(buf, off, len, this.filePos);
      this.filePos += bytesWritten;
      off += bytesWritten;
      len -= bytesWritten;
    }
  }

  private checkRoom(len: number): void {
    if (this.written + len > this.newDataSize) throw corrupt("输出超过头中声明的 newDataSize");
  }

  async write(src: Buffer, off: number, len: number): Promise<void> {
    this.checkRoom(len);
    this.written += len;
    // 缓冲为空且数据块不小于缓冲：直写，省一次拷贝
    if (this.fill === 0 && len >= kOutCacheSize) {
      await this.writeAll(src, off, len);
      return;
    }
    while (len > 0) {
      if (this.fill === kOutCacheSize) await this.flushCache();
      const take = Math.min(len, kOutCacheSize - this.fill);
      src.copy(this.cache, this.fill, off, off + take);
      this.fill += take;
      off += take;
      len -= take;
    }
  }

  /** 预留缓冲中的一段（最多 want 字节）供调用方原地填充，再用 commit 确认。 */
  async reserve(want: number): Promise<number> {
    if (this.fill === kOutCacheSize) await this.flushCache();
    const n = Math.min(want, kOutCacheSize - this.fill);
    this.checkRoom(n);
    return n;
  }

  get reservedOffset(): number {
    return this.fill;
  }

  commit(n: number): void {
    this.fill += n;
    this.written += n;
  }

  async finish(): Promise<void> {
    await this.flushCache();
    if (this.written !== this.newDataSize) throw corrupt("输出长度与头中声明的 newDataSize 不符");
  }
}

/** rle0 差值解码器：交替 [len0 个零差值][lenv 个字节差值]（对应 rle0_decoder_t）。 */
class Rle0Decoder {
  private len0 = 0;
  private lenv = 0;
  private needDecode0 = true;
  private readonly cur: { p: number };

  private readonly code: Uint8Array;
  private readonly end: number;

  constructor(code: Uint8Array, begin: number, end: number) {
    this.code = code;
    this.end = end;
    this.cur = { p: begin };
  }

  /** 把解码出的差值按字节加到 out[off, off+size)（原地），差值为 0 的区段不触碰。 */
  add(out: Buffer, off: number, size: number): void {
    while (size > 0) {
      if (this.len0 > 0) {
        const take = Math.min(this.len0, size);
        this.len0 -= take;
        off += take;
        size -= take;
      } else if (this.lenv > 0) {
        const take = Math.min(this.lenv, size);
        const code = this.code;
        let p = this.cur.p;
        for (let i = off, e = off + take; i < e; i++) out[i] = (out[i]! + code[p++]!) & 0xff;
        this.cur.p = p;
        this.lenv -= take;
        off += take;
        size -= take;
      } else if (this.needDecode0) {
        this.needDecode0 = false;
        this.len0 = unpackUInt(this.code, this.cur, this.end, 0);
      } else {
        this.needDecode0 = true;
        const lenv = unpackUInt(this.code, this.cur, this.end, 0);
        if (lenv > this.end - this.cur.p) throw corrupt("rle0 字节差值越界");
        this.lenv = lenv;
      }
    }
  }
}

async function readFully(fh: FileHandle, buf: Buffer, off: number, len: number, pos: number): Promise<void> {
  while (len > 0) {
    const { bytesRead } = await fh.read(buf, off, len, pos);
    if (bytesRead === 0) throw corrupt("旧文件读取越界或被截断");
    off += bytesRead;
    pos += bytesRead;
    len -= bytesRead;
  }
}

/**
 * 把 HDiffPatch 单流补丁（HDIFFSF20，压缩为 zstd 或不压缩）应用到 oldPath，结果写到 outPath。
 * 格式不支持时抛 HPatchFormatError；数据损坏抛 Error。失败时会删除未写完的 outPath。
 */
export async function applySingleStreamPatch(options: {
  oldPath: string;
  patchPath: string;
  outPath: string;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const { oldPath, patchPath, outPath, signal } = options;
  signal?.throwIfAborted();

  const patchFh = await open(patchPath, "r");
  let info: DiffInfo;
  let patchSize: number;
  try {
    patchSize = (await patchFh.stat()).size;
    const head = Buffer.allocUnsafe(Math.min(kHeadReadSize, patchSize));
    await readFully(patchFh, head, 0, head.length, 0).catch(() => {
      throw new HPatchFormatError("补丁文件过短");
    });
    info = parseHeader(head);
  } finally {
    await patchFh.close();
  }

  const isCompressed = info.compressedSize !== 0;
  // 上游在没有解压器（类型为空）却声明了压缩数据时直接拒绝
  if (isCompressed && info.compressType === "") throw new HPatchFormatError("补丁声明了压缩数据但没有压缩类型");
  const dataLen = isCompressed ? info.compressedSize : info.uncompressedSize;
  if (info.diffDataPos + dataLen > patchSize) throw corrupt("补丁文件被截断");

  const oldFh = await open(oldPath, "r");
  let outFh: FileHandle | undefined;
  let source: Readable | undefined;
  let outCreated = false;
  try {
    const oldSize = (await oldFh.stat()).size;
    if (oldSize !== info.oldDataSize) {
      throw new Error(`旧文件大小 ${oldSize} 与补丁要求的 ${info.oldDataSize} 不符`);
    }

    outFh = await open(outPath, "w");
    outCreated = true;

    const raw = createReadStream(patchPath, {
      start: info.diffDataPos,
      end: info.diffDataPos + dataLen - 1,
      highWaterMark: kStreamChunk,
    });
    // 取消由主循环里的 signal.throwIfAborted() 响应，随后 finally 销毁流；不挂监听器以免泄漏
    // Node 默认只接受 2^27 的 zstd 窗口；长窗口压缩的补丁会每次都解压失败、悄悄退回全量下载
    source = isCompressed
      ? pipeline(
          raw,
          createZstdDecompress({ chunkSize: kStreamChunk, params: { [zlibConstants.ZSTD_d_windowLogMax]: 31 } }),
          () => {},
        )
      : raw;
    const diff = new DiffReader(source, info.uncompressedSize);
    const out = new OutWriter(outFh, info.newDataSize);
    const stepBuf = Buffer.allocUnsafe(info.stepMemSize);

    let coverCount = info.coverCount;
    // sspatch_covers_t 的状态
    let lastOldEnd = 0;
    let lastNewEnd = 0;
    let curOldPos = 0;
    let curNewPos = 0;
    let curLength = 0;

    while (coverCount > 0) {
      signal?.throwIfAborted();
      const bufCoverSize = await diff.readUInt();
      const bufRleSize = await diff.readUInt();
      if (
        bufCoverSize > info.stepMemSize ||
        bufRleSize > info.stepMemSize ||
        bufCoverSize + bufRleSize > info.stepMemSize
      ) {
        throw corrupt("step 缓冲超过 stepMemSize");
      }
      const coversEnd = bufCoverSize;
      const stepEnd = bufCoverSize + bufRleSize;
      await diff.readInto(stepBuf, stepEnd);
      const rle = new Rle0Decoder(stepBuf, coversEnd, stepEnd);
      const cc = { p: 0 };

      while (cc.p !== coversEnd) {
        // sspatch_covers_nextCover：oldPos 带符号增量（符号占首字节最高位），newPos/length 为无符号增量
        const oldIncSign = stepBuf[cc.p]! >> 7;
        lastOldEnd = curOldPos + curLength;
        lastNewEnd = curNewPos + curLength;
        const oldInc = unpackUInt(stepBuf, cc, coversEnd, 1);
        curOldPos = oldIncSign === 0 ? lastOldEnd + oldInc : lastOldEnd - oldInc;
        curNewPos = lastNewEnd + unpackUInt(stepBuf, cc, coversEnd, 0);
        curLength = unpackUInt(stepBuf, cc, coversEnd, 0);

        if (curNewPos > lastNewEnd) await diff.copyTo(out, curNewPos - lastNewEnd);

        --coverCount;
        if (curLength > 0) {
          if (curOldPos < 0 || curOldPos > oldSize || curLength > oldSize - curOldPos) {
            throw corrupt("cover 超出旧文件范围");
          }
          // 旧数据直接读进输出缓冲，再原地加 rle0 差值，避免中转拷贝
          let oldPos = curOldPos;
          let left = curLength;
          while (left > 0) {
            const n = await out.reserve(left);
            const off = out.reservedOffset;
            await readFully(oldFh, out.cache, off, n, oldPos);
            rle.add(out.cache, off, n);
            out.commit(n);
            oldPos += n;
            left -= n;
          }
        } else if (coverCount !== 0) {
          throw corrupt("长度为 0 的 cover 只能出现在末尾");
        }
        signal?.throwIfAborted();
      }
    }

    await out.finish();
    if (!(await diff.isFinish())) throw corrupt("补丁数据流存在多余或缺失字节");
  } catch (e) {
    source?.destroy();
    await outFh?.close().catch(() => {});
    outFh = undefined;
    if (outCreated) await unlink(outPath).catch(() => {});
    throw e;
  } finally {
    source?.destroy();
    await oldFh.close();
    await outFh?.close();
  }
}
