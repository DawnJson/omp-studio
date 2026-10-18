/**
 * 测试夹具：按 HDIFFSF20 格式手工编码单流补丁（只用于验证 hpatch.ts，与 HDiffPatch 的 diff 端无关）。
 * 布局与 hpatch.ts 的解码端一一对应：头 + 单个 step + 末尾长度为 0 的终止 cover。
 */
import { zstdCompressSync } from "node:zlib";

/** varint 编码：首字节高位留 tagBit 位给标签（tagValue），续接位在其下一位；其余字节每字节 7 位。 */
function packUInt(out: number[], value: number, tagBit: number, tagValue: number): void {
  const firstMask = (1 << (7 - tagBit)) - 1;
  const rest: number[] = [];
  while (value > firstMask) {
    rest.push(value % 128);
    value = Math.floor(value / 128);
  }
  let first = value | (tagValue << (8 - tagBit));
  if (rest.length > 0) first |= 1 << (7 - tagBit);
  out.push(first);
  for (let i = rest.length - 1; i >= 0; i--) out.push(i === 0 ? rest[i]! : rest[i]! | 0x80);
}

/** 测试用：按 HDIFFSF20 格式手工编码一个补丁，把 oldData 变成 newData。covers 由调用方给（newPos/oldPos/length，按 newPos 递增、不重叠），其余字节作为 newData 存入；compress 为 "" 或 "zstd"（zstd 用 zlib.zstdCompressSync）。 */
export function encodeSingleStreamPatch(
  oldData: Buffer,
  newData: Buffer,
  covers: { oldPos: number; newPos: number; length: number }[],
  compress: "" | "zstd",
): Buffer {
  // 末尾追加长度为 0、位置在 newData 末端的终止 cover，解码端靠它收尾并带出尾部新增字节
  const all = [...covers, { oldPos: -1, newPos: newData.length, length: 0 }];

  const coverBuf: number[] = [];
  const rleBuf: number[] = [];
  const gapChunks: Buffer[] = [];
  const diffs: number[] = []; // 所有 cover 的 new-old 差值（按顺序拼接）
  let lastOldEnd = 0;
  let lastNewEnd = 0;
  for (const c of all) {
    const isTail = c.oldPos < 0;
    const oldPos = isTail ? lastOldEnd : c.oldPos;
    if (c.newPos < lastNewEnd) throw new Error("covers 必须按 newPos 递增且不重叠");
    if (!isTail && (c.length <= 0 || oldPos + c.length > oldData.length || c.newPos + c.length > newData.length)) {
      throw new Error("cover 越界或长度非法");
    }
    if (oldPos >= lastOldEnd) packUInt(coverBuf, oldPos - lastOldEnd, 1, 0);
    else packUInt(coverBuf, lastOldEnd - oldPos, 1, 1);
    packUInt(coverBuf, c.newPos - lastNewEnd, 0, 0);
    packUInt(coverBuf, c.length, 0, 0);
    gapChunks.push(newData.subarray(lastNewEnd, c.newPos));
    for (let i = 0; i < c.length; i++) diffs.push((newData[c.newPos + i]! - oldData[oldPos + i]! + 256) & 0xff);
    lastOldEnd = oldPos + c.length;
    lastNewEnd = c.newPos + c.length;
  }

  // rle0：交替 [零差值个数][非零段长度][非零段字节]，从零段开始
  for (let i = 0; i < diffs.length;) {
    let z = 0;
    while (i + z < diffs.length && diffs[i + z] === 0) z++;
    packUInt(rleBuf, z, 0, 0);
    i += z;
    if (i >= diffs.length) break;
    let v = 0;
    while (i + v < diffs.length && diffs[i + v] !== 0) v++;
    packUInt(rleBuf, v, 0, 0);
    for (let k = 0; k < v; k++) rleBuf.push(diffs[i + k]!);
    i += v;
  }

  const stepHead: number[] = [];
  packUInt(stepHead, coverBuf.length, 0, 0);
  packUInt(stepHead, rleBuf.length, 0, 0);
  const data = Buffer.concat([Buffer.from(stepHead), Buffer.from(coverBuf), Buffer.from(rleBuf), ...gapChunks]);
  const packed = compress === "zstd" ? zstdCompressSync(data) : data;
  if (compress === "zstd" && packed.length > data.length)
    throw new Error("zstd 压缩后反而更大，头约束 compressedSize<=uncompressedSize 不成立");

  const head: number[] = [...Buffer.from(`HDIFFSF20&${compress}\0`, "latin1")];
  packUInt(head, newData.length, 0, 0);
  packUInt(head, oldData.length, 0, 0);
  packUInt(head, all.length, 0, 0);
  packUInt(head, coverBuf.length + rleBuf.length, 0, 0); // stepMemSize
  packUInt(head, data.length, 0, 0);
  packUInt(head, compress === "zstd" ? packed.length : 0, 0, 0);
  return Buffer.concat([Buffer.from(head), packed]);
}
