// omp stdout 的解码：按 `\n` 切行、解析 JSON、把协议 v2 的 `rpc_chunk` 序列重组成一个逻辑帧。
// 规则见 omp 文档 rpc.md "Transport and Framing"。

/** 解码后的逻辑帧，至少带一个字符串 `type`。 */
export type RawFrame = { type: string } & Record<string, unknown>;

/** omp 写出了不符合协议的字节。连接无法继续，调用方应当结束 omp。 */
export class RpcProtocolError extends Error {
  override name = "RpcProtocolError";
}

const NEWLINE = 0x0a;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

interface PendingChunk {
  chunkId: string;
  count: number;
  byteLength: number;
  parts: Buffer[];
  received: number;
}

export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0);
  #chunk: PendingChunk | null = null;
  #maxReassembledBytes: number;

  constructor(maxReassembledBytes: number) {
    this.#maxReassembledBytes = maxReassembledBytes;
  }

  /** 协商出的重组上限（`ready.maxReassembledFrameBytes`）。 */
  setMaxReassembledBytes(bytes: number): void {
    this.#maxReassembledBytes = bytes;
  }

  /** 喂入一段 stdout 字节，返回其中凑齐的逻辑帧。出错时抛 `RpcProtocolError`。 */
  push(data: Buffer): RawFrame[] {
    this.#buffer = this.#buffer.length === 0 ? data : Buffer.concat([this.#buffer, data]);
    const frames: RawFrame[] = [];
    let start = 0;
    let newline: number;
    while ((newline = this.#buffer.indexOf(NEWLINE, start)) !== -1) {
      const line = this.#buffer.subarray(start, newline);
      start = newline + 1;
      const frame = this.#decodeLine(line);
      if (frame) frames.push(frame);
    }
    this.#buffer = start === this.#buffer.length ? Buffer.alloc(0) : this.#buffer.subarray(start);
    return frames;
  }

  /** stdout 结束时调用：残留半行或未完成的分块序列都是协议错误。 */
  end(): void {
    if (this.#buffer.toString("utf8").trim() !== "") throw new RpcProtocolError("stdout ended inside a frame");
    if (this.#chunk) throw new RpcProtocolError(`stdout ended inside rpc_chunk sequence ${this.#chunk.chunkId}`);
  }

  #decodeLine(line: Buffer): RawFrame | null {
    let text: string;
    try {
      text = strictUtf8.decode(line);
    } catch {
      throw new RpcProtocolError("frame is not valid UTF-8");
    }
    if (text.trim() === "") return null;
    const frame = parseFrame(text);
    if (frame.type === "rpc_chunk") return this.#acceptChunk(frame);
    if (this.#chunk) throw new RpcProtocolError(`rpc_chunk sequence ${this.#chunk.chunkId} interrupted by ${frame.type}`);
    return frame;
  }

  #acceptChunk(frame: RawFrame): RawFrame | null {
    const { chunkId, index, count, byteLength, data } = frame;
    if (
      typeof chunkId !== "string" ||
      !isNonNegativeInteger(index) ||
      !isNonNegativeInteger(count) ||
      count === 0 ||
      !isNonNegativeInteger(byteLength) ||
      typeof data !== "string"
    ) {
      throw new RpcProtocolError("malformed rpc_chunk frame");
    }

    if (index === 0) {
      if (this.#chunk) throw new RpcProtocolError(`rpc_chunk sequence ${this.#chunk.chunkId} interleaved with ${chunkId}`);
      if (byteLength > this.#maxReassembledBytes) {
        throw new RpcProtocolError(`rpc_chunk ${chunkId} declares ${byteLength} bytes, above the ${this.#maxReassembledBytes} byte limit`);
      }
      this.#chunk = { chunkId, count, byteLength, parts: [], received: 0 };
    }

    const pending = this.#chunk;
    if (!pending || pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.parts.length !== index) {
      throw new RpcProtocolError(`rpc_chunk ${chunkId} index ${index} is out of sequence`);
    }

    // Buffer.from(…, "base64") 会静默跳过非法字符，所以先校验。
    if (data.length % 4 !== 0 || !BASE64.test(data)) throw new RpcProtocolError(`rpc_chunk ${chunkId} index ${index} data is not base64`);
    const part = Buffer.from(data, "base64");
    pending.received += part.length;
    if (pending.received > pending.byteLength) throw new RpcProtocolError(`rpc_chunk ${chunkId} exceeds its declared byteLength`);
    pending.parts.push(part);
    if (pending.parts.length < pending.count) return null;

    this.#chunk = null;
    if (pending.received !== pending.byteLength) throw new RpcProtocolError(`rpc_chunk ${chunkId} is shorter than its declared byteLength`);
    let text: string;
    try {
      text = strictUtf8.decode(Buffer.concat(pending.parts, pending.received));
    } catch {
      throw new RpcProtocolError(`rpc_chunk ${chunkId} is not valid UTF-8`);
    }
    const reassembled = parseFrame(text);
    if (reassembled.type === "rpc_chunk") throw new RpcProtocolError(`rpc_chunk ${chunkId} contains another rpc_chunk`);
    return reassembled;
  }
}

function parseFrame(text: string): RawFrame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RpcProtocolError(`frame is not valid JSON: ${text.slice(0, 200)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value) || typeof value.type !== "string") {
    throw new RpcProtocolError(`frame is not an object with a string type: ${text.slice(0, 200)}`);
  }
  // JSON.parse 的结果是普通对象，上面已校验 `type` 是字符串，其余字段由调用方按 `type` 自行判断。
  const frame: RawFrame = value as RawFrame;
  return frame;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
