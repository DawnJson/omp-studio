import { describe, expect, it } from "vitest";
import { FrameDecoder, RpcProtocolError } from "../src/main/omp/frame-decoder.ts";

const line = (value: object) => Buffer.from(JSON.stringify(value) + "\n");

/** 按 rpc.md 的规则把一个对象切成 rpc_chunk 帧。 */
function chunked(value: object, chunkId: string, partBytes: number) {
  const bytes = Buffer.from(JSON.stringify(value));
  const parts: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += partBytes) parts.push(bytes.subarray(i, i + partBytes));
  return parts.map((part, index) => ({
    type: "rpc_chunk",
    chunkId,
    index,
    count: parts.length,
    byteLength: bytes.length,
    data: part.toString("base64"),
  }));
}

describe("FrameDecoder", () => {
  it("frames split anywhere, including inside a multi-byte character, decode to the same frames", () => {
    const bytes = Buffer.concat([line({ type: "message_update", text: "中文输出" }), line({ type: "agent_end" })]);
    for (let cut = 1; cut < bytes.length; cut++) {
      const decoder = new FrameDecoder(1024);
      const frames = [...decoder.push(bytes.subarray(0, cut)), ...decoder.push(bytes.subarray(cut))];
      expect(frames).toEqual([{ type: "message_update", text: "中文输出" }, { type: "agent_end" }]);
    }
  });

  it("holds an unterminated line until its newline arrives", () => {
    const decoder = new FrameDecoder(1024);
    expect(decoder.push(Buffer.from('{"type":"ready"}'))).toEqual([]);
    expect(decoder.push(Buffer.from("\n"))).toEqual([{ type: "ready" }]);
  });

  it("reassembles an rpc_chunk sequence into one frame, with UTF-8 split across parts", () => {
    const frame = { type: "response", id: "req-1", success: true, data: { text: "跨分块的中文".repeat(20) } };
    const decoder = new FrameDecoder(1024 * 1024);
    const frames = chunked(frame, "rpc-1", 7).flatMap((chunk) => decoder.push(line(chunk)));
    expect(frames).toEqual([frame]);
  });

  it.each([
    ["interrupted by a normal frame", (chunks: object[]) => [chunks[0]!, { type: "agent_end" }]],
    ["interleaved with another sequence", (chunks: object[]) => [chunks[0]!, chunked({ type: "x" }, "rpc-2", 4)[0]!]],
    ["parts out of order", (chunks: object[]) => [chunks[0]!, chunks[2]!]],
  ])("rejects a chunk sequence %s", (_, arrange) => {
    const decoder = new FrameDecoder(1024 * 1024);
    const chunks = chunked({ type: "response", data: "x".repeat(100) }, "rpc-1", 10);
    expect(() => arrange(chunks).forEach((chunk) => decoder.push(line(chunk)))).toThrow(RpcProtocolError);
  });

  it("rejects a sequence that declares more bytes than the negotiated limit", () => {
    const decoder = new FrameDecoder(1024 * 1024);
    decoder.setMaxReassembledBytes(50);
    const chunks = chunked({ type: "response", data: "x".repeat(100) }, "rpc-1", 10);
    expect(() => decoder.push(line(chunks[0]!))).toThrow(/byte limit/);
  });

  it("rejects a sequence whose parts add up to a different byteLength", () => {
    const decoder = new FrameDecoder(1024 * 1024);
    const chunks = chunked({ type: "response" }, "rpc-1", 4).map((chunk) => ({
      ...chunk,
      byteLength: chunk.byteLength + 1,
    }));
    expect(() => chunks.forEach((chunk) => decoder.push(line(chunk)))).toThrow(/shorter/);
  });

  it.each([
    ["not JSON", "hello\n"],
    ["JSON without a string type", '{"id":1}\n'],
    ["an array", "[1]\n"],
  ])("rejects a line that is %s", (_, text) => {
    expect(() => new FrameDecoder(1024).push(Buffer.from(text))).toThrow(RpcProtocolError);
  });

  it("reports stdout ending mid-frame or mid-sequence", () => {
    const halfLine = new FrameDecoder(1024);
    halfLine.push(Buffer.from('{"type":'));
    expect(() => halfLine.end()).toThrow(/inside a frame/);

    const halfSequence = new FrameDecoder(1024 * 1024);
    halfSequence.push(line(chunked({ type: "response", data: "x".repeat(50) }, "rpc-1", 10)[0]!));
    expect(() => halfSequence.end()).toThrow(/rpc_chunk/);
  });
});
