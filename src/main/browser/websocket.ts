// CDP 转接用的最小 WebSocket 服务端（RFC 6455）：只收发文本消息，处理分片、ping 和 close。
// 客户端只有本机的 omp（puppeteer），不需要扩展和二进制消息；不为这一处新增运行时依赖。
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** 收到的一条消息（含分片拼起来）的上限：CDP 命令都很小，超了说明对端不对，直接断开。 */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export interface WebSocketPeer {
  send(text: string): void;
  close(): void;
}

export interface WebSocketHandlers {
  message(text: string): void;
  closed(): void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** 完成握手，之后按帧读写。握手头不合法时直接断开，返回 null。 */
export function acceptWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  open: (peer: WebSocketPeer) => WebSocketHandlers,
): WebSocketPeer | null {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string" || request.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return null;
  }
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let closed = false;
  const peer: WebSocketPeer = {
    send(text) {
      if (!closed) socket.write(frame(0x1, Buffer.from(text, "utf8")));
    },
    close() {
      if (closed) return;
      socket.end(frame(0x8, Buffer.alloc(0)));
      finish();
    },
  };
  const handlers = open(peer);
  function finish(): void {
    if (closed) return;
    closed = true;
    handlers.closed();
  }

  let buffer: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partsLength = 0;
  const onData = (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0]! & 0x80) !== 0;
      const opcode = buffer[0]! & 0x0f;
      const masked = (buffer[1]! & 0x80) !== 0;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) {
          socket.destroy();
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (partsLength + length > MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
      }
      buffer = buffer.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        peer.close();
        return;
      }
      if (opcode === 0x9) {
        socket.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        parts.push(payload);
        partsLength += payload.length;
        if (fin) {
          const text = Buffer.concat(parts).toString("utf8");
          parts = [];
          partsLength = 0;
          handlers.message(text);
        }
      }
      // 二进制帧（0x2）和 pong（0xA）不用，丢掉。
    }
  };
  socket.on("data", onData);
  socket.on("close", finish);
  socket.on("error", finish);
  return peer;
}
