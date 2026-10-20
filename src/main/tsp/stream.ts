// pty 输出的增量解析：omp 的输出里夹着 TSP 的 APC 串、OSC（会话文件、标题、通知）和 DA1 查询，其余 ANSI 全部丢弃。
// 数据可以在任意字节处断开（pty 的块边界不管转义序列），所以解析器是一个按字节推进的状态机，状态跨 write() 保留。
//
// 输入按字节处理（node-pty 用 `encoding: null` 给 Buffer）：规范允许 TSP 的分块切在 UTF-8 字符中间
// （protocol/transport「Chunking」：先按字节拼接再解析），按字符串解码会把被切开的字符变成 U+FFFD。

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
const LEFT_BRACKET = 0x5b;
const RIGHT_BRACKET = 0x5d;
const UNDERSCORE = 0x5f;

/** 规范：一个 APC 串最长 262 144 字节，之后 Tern 丢弃；omp 自己按 hello 的 apc（65 536）分块。留一倍余量。 */
const MAX_APC_BYTES = 512 * 1024;
/** OSC（标题、通知、SetUserVar）远小于这个值；超过的一律是垃圾。 */
const MAX_OSC_BYTES = 256 * 1024;
/** 分块拼接后的上限（规范：一条分块消息拼起来最多 24 MiB）。 */
const MAX_JOINED_BYTES = 24 * 1024 * 1024;
/** CSI 的参数和中间字节最多这么长，超过按损坏处理（防止永不结束的序列吞掉整条流）。 */
const MAX_CSI_BYTES = 64;

const decoder = new TextDecoder("utf-8");

export interface TspStreamMessage {
  type: "tsp";
  verb: string;
  /** `k=v` 参数；分块消息保留第一块的参数（`c`、`m` 除外）。 */
  params: Readonly<Record<string, string>>;
  /** UTF-8 JSON（`b` 是 base64）。 */
  body: string;
}

/** 分块序列被丢弃（规范：Tern 回 `error` 事件）。 */
export interface TspStreamChunkDropped {
  type: "chunk-dropped";
  verb: string;
  chunk: string;
  reason: "interrupted" | "over-limit";
}

export interface TspStreamUserVar {
  type: "user-var";
  name: string;
  /** 已解 base64。 */
  value: string;
}

export interface TspStreamTitle {
  type: "title";
  title: string;
}

export interface TspStreamNotify {
  type: "notify";
  title: string;
  body: string;
}

export interface TspStreamDa1 {
  type: "da1";
}

/** 普通可见文字（不在任何转义序列里）：TSP 模式下几乎没有，启动失败时 omp 打印的错误信息在这里，会话留一小段尾巴用于报错。 */
export interface TspStreamText {
  type: "text";
  text: string;
}

export type TspStreamEvent =
  | TspStreamMessage
  | TspStreamChunkDropped
  | TspStreamUserVar
  | TspStreamTitle
  | TspStreamNotify
  | TspStreamDa1
  | TspStreamText;

type State =
  | { kind: "ground" }
  | { kind: "esc" }
  | { kind: "csi"; bytes: number[] }
  /** 字符串序列：APC（含 TSP）、OSC，以及要跳过的 DCS/PM/SOS。 */
  | {
      kind: "string";
      type: "apc" | "osc" | "skip";
      chunks: Uint8Array[];
      length: number;
      pendingEsc: boolean;
      overflow: boolean;
    };

/** 参数段：`key=value`，key `[A-Za-z0-9_-]+`，value 是不含 `;` 和空格的可打印 ASCII。 */
const PARAM = /^([A-Za-z0-9_-]+)=([\x21-\x3a\x3c-\x7e]*)$/;

interface ChunkSequence {
  verb: string;
  chunk: string;
  params: Record<string, string>;
  /** 已经收到的字节数。 */
  length: number;
  bytes: Uint8Array[];
}

export class TspStreamParser {
  readonly #emit: (event: TspStreamEvent) => void;
  #state: State = { kind: "ground" };
  /** 文字可能在一个 UTF-8 字符中间断开。 */
  readonly #textDecoder = new TextDecoder("utf-8");
  #sequence: ChunkSequence | null = null;
  /** OSC 99（kitty 通知）按 id 累积：title 和 body 可能分几条到达。 */
  readonly #kittyNotes = new Map<string, { title: string; body: string }>();

  constructor(emit: (event: TspStreamEvent) => void) {
    this.#emit = emit;
  }

  write(data: Uint8Array | string): void {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    // 当前字符串序列里还没入账的内容起点；-1 = 没有。
    let start = -1;
    // 当前普通文字的起点；-1 = 没有。
    let textStart = -1;
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] as number;
      const state = this.#state;
      switch (state.kind) {
        case "ground":
          if (byte === ESC) {
            if (textStart >= 0) this.#text(bytes, textStart, i);
            textStart = -1;
            this.#state = { kind: "esc" };
          } else if (byte >= 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) {
            if (textStart < 0) textStart = i;
          } else if (textStart >= 0) {
            this.#text(bytes, textStart, i);
            textStart = -1;
          }
          break;
        case "esc":
          this.#escape(byte);
          break;
        case "csi":
          this.#csi(state, byte);
          break;
        case "string":
          if (state.pendingEsc) {
            state.pendingEsc = false;
            if (byte === BACKSLASH) {
              this.#endString(state);
              break;
            }
            // ESC 后跟别的字节：字符串被中止，这个 ESC 开始新的序列（xterm 的做法）。
            this.#state = { kind: "esc" };
            this.#escape(byte);
            break;
          }
          if (byte === ESC) {
            this.#append(state, bytes, start, i);
            start = -1;
            state.pendingEsc = true;
          } else if (byte === BEL) {
            // 规范只定义 ST，但 Tern 的解析器对任何字符串都认 BEL（kitty 的做法），这里一样。
            this.#append(state, bytes, start, i);
            start = -1;
            this.#endString(state);
          } else if (start < 0) {
            start = i;
          }
          break;
      }
    }
    // 这一块结束时字符串还没结束：已有的内容先入账，下一块接着来。
    if (start >= 0 && this.#state.kind === "string") this.#append(this.#state, bytes, start, bytes.length);
    if (textStart >= 0 && this.#state.kind === "ground") this.#text(bytes, textStart, bytes.length);
  }

  #text(bytes: Uint8Array, from: number, to: number): void {
    const text = this.#textDecoder.decode(bytes.subarray(from, to), { stream: true });
    if (text !== "") this.#emit({ type: "text", text });
  }

  /** 把 [from, to) 入账到当前字符串；超长的字符串整体作废（结束时 overflow 为 true）。 */
  #append(state: Extract<State, { kind: "string" }>, bytes: Uint8Array, from: number, to: number): void {
    if (from < 0 || to <= from || state.type === "skip" || state.overflow) return;
    const limit = state.type === "apc" ? MAX_APC_BYTES : MAX_OSC_BYTES;
    if (state.length + (to - from) > limit) {
      state.overflow = true;
      state.chunks = [];
      return;
    }
    // 拷贝：调用方的缓冲区之后会被 pty 复用或回收。
    state.chunks.push(new Uint8Array(bytes.subarray(from, to)));
    state.length += to - from;
  }

  #escape(byte: number): void {
    switch (byte) {
      case LEFT_BRACKET:
        this.#state = { kind: "csi", bytes: [] };
        return;
      case RIGHT_BRACKET:
        this.#state = { kind: "string", type: "osc", chunks: [], length: 0, pendingEsc: false, overflow: false };
        return;
      case UNDERSCORE:
        this.#state = { kind: "string", type: "apc", chunks: [], length: 0, pendingEsc: false, overflow: false };
        return;
      case 0x50 /* P: DCS */:
      case 0x58 /* X: SOS */:
      case 0x5e /* ^: PM */:
        this.#state = { kind: "string", type: "skip", chunks: [], length: 0, pendingEsc: false, overflow: false };
        return;
      case ESC:
        // ESC ESC：后一个 ESC 才是序列开头。
        this.#state = { kind: "esc" };
        return;
      default:
        // 0x20–0x2f 是中间字节（ESC ( B 之类还有一个终结字节），其余是两字节转义：都对我们没有意义，丢弃。
        // 中间字节之后的终结字节会作为普通字符落进 ground，没有影响。
        this.#state = { kind: "ground" };
    }
  }

  #csi(state: Extract<State, { kind: "csi" }>, byte: number): void {
    if (byte === ESC) {
      // CSI 被新的转义打断。
      this.#state = { kind: "esc" };
      return;
    }
    if (byte >= 0x40 && byte <= 0x7e) {
      this.#state = { kind: "ground" };
      // DA1 请求：`ESC [ c` 或 `ESC [ 0 c`（`?`、`>` 开头的是 DA 变体和私有序列，不是 DA1）。
      if (byte === 0x63 && (state.bytes.length === 0 || (state.bytes.length === 1 && state.bytes[0] === 0x30)))
        this.#emit({ type: "da1" });
      return;
    }
    if (byte < 0x20 || byte > 0x3f) {
      // 不是合法的 CSI 内容（控制字符、高位字节）：按损坏处理，回到 ground。
      this.#state = { kind: "ground" };
      return;
    }
    if (state.bytes.length >= MAX_CSI_BYTES) {
      this.#state = { kind: "ground" };
      return;
    }
    state.bytes.push(byte);
  }

  #endString(state: Extract<State, { kind: "string" }>): void {
    this.#state = { kind: "ground" };
    if (state.type === "skip") return;
    if (state.overflow) {
      // 超长的 APC 可能是分块序列的一块：序列作废。
      if (state.type === "apc") this.#interrupt("interrupted");
      return;
    }
    const content = joinBytes(state.chunks, state.length);
    if (state.type === "apc") this.#apc(content);
    else this.#osc(decoder.decode(content));
  }

  // ───── APC ─────

  #apc(content: Uint8Array): void {
    // 只认 `tsp;` 开头的 APC；别的程序的 APC 丢弃（也不打断分块序列：规范说的是"另一个 TSP 消息"）。
    if (content.length < 5 || content[0] !== 0x74 || content[1] !== 0x73 || content[2] !== 0x70 || content[3] !== 0x3b)
      return;
    this.#tspMessage(content.subarray(4));
  }

  /** `<verb>[;k=v]*;<body>`：参数的判定规则见 protocol/transport。头部一定是 ASCII；body 保持原字节以便分块拼接。 */
  #tspMessage(content: Uint8Array): void {
    const verb = String.fromCharCode(content[0] as number);
    const params: Record<string, string> = {};
    if (content.length === 1) {
      this.#message(verb, params, new Uint8Array(0));
      return;
    }
    // `tsp;q` 后面不是 `;`：动词不止一个字母，按未知动词忽略。
    if (content[1] !== 0x3b) return;
    let pos = 2;
    for (;;) {
      const semi = content.indexOf(0x3b, pos);
      if (semi < 0) break;
      const segment = latin1(content, pos, semi);
      const match = PARAM.exec(segment);
      if (!match) break;
      params[match[1] as string] = match[2] as string;
      pos = semi + 1;
    }
    this.#message(verb, params, content.subarray(pos));
  }

  #message(verb: string, params: Record<string, string>, body: Uint8Array): void {
    const chunkId = params["c"];
    if (chunkId === undefined) {
      // 不带 c 的消息打断进行中的分块序列，然后照常处理。
      this.#interrupt("interrupted");
      this.#deliver(verb, params, body);
      return;
    }
    const more = params["m"] === "1";
    const sequence = this.#sequence;
    if (sequence && (sequence.chunk !== chunkId || sequence.verb !== verb)) this.#interrupt("interrupted");
    let current = this.#sequence;
    if (!current) {
      const rest = { ...params };
      delete rest["c"];
      delete rest["m"];
      current = { verb, chunk: chunkId, params: rest, length: 0, bytes: [] };
      this.#sequence = current;
    }
    current.length += body.length;
    if (current.length > MAX_JOINED_BYTES) {
      this.#interrupt("over-limit");
      return;
    }
    current.bytes.push(body);
    if (more) return;
    this.#sequence = null;
    this.#deliver(current.verb, current.params, joinBytes(current.bytes, current.length));
  }

  #interrupt(reason: "interrupted" | "over-limit"): void {
    const sequence = this.#sequence;
    if (!sequence) return;
    this.#sequence = null;
    this.#emit({ type: "chunk-dropped", verb: sequence.verb, chunk: sequence.chunk, reason });
  }

  #deliver(verb: string, params: Record<string, string>, body: Uint8Array): void {
    this.#emit({ type: "tsp", verb, params, body: decoder.decode(body) });
  }

  // ───── OSC ─────

  #osc(text: string): void {
    const semi = text.indexOf(";");
    const code = semi < 0 ? text : text.slice(0, semi);
    const rest = semi < 0 ? "" : text.slice(semi + 1);
    switch (code) {
      case "0":
      case "2":
        this.#emit({ type: "title", title: rest });
        return;
      case "9":
        // ConEmu 的 `9;4;…` 是进度条，不是通知。
        if (/^4(;|$)/.test(rest)) return;
        this.#emit({ type: "notify", title: "", body: rest });
        return;
      case "99":
        this.#kitty(rest);
        return;
      case "1337": {
        const match = /^SetUserVar=([^=]+)=(.*)$/s.exec(rest);
        if (match) this.#emit({ type: "user-var", name: match[1] as string, value: decodeBase64(match[2] as string) });
        return;
      }
      default:
        return;
    }
  }

  /** kitty 通知协议：`99;<k=v:k=v>;<payload>`，`i` 是通知 id，`d=0` 表示还有后续，`p` 是 title（默认）或 body。 */
  #kitty(rest: string): void {
    const semi = rest.indexOf(";");
    const meta = semi < 0 ? rest : rest.slice(0, semi);
    let payload = semi < 0 ? "" : rest.slice(semi + 1);
    const fields = new Map<string, string>();
    for (const pair of meta.split(":")) {
      const eq = pair.indexOf("=");
      if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    if (fields.get("e") === "1") payload = decodeBase64(payload);
    const id = fields.get("i") ?? "";
    const note = this.#kittyNotes.get(id) ?? { title: "", body: "" };
    const part = fields.get("p") ?? "title";
    if (part === "title") note.title += payload;
    else if (part === "body") note.body += payload;
    else return; // close、alive、? 等控制载荷不是通知内容
    if (fields.get("d") === "0") {
      this.#kittyNotes.set(id, note);
      return;
    }
    this.#kittyNotes.delete(id);
    this.#emit({ type: "notify", title: note.title, body: note.body });
  }
}

function joinBytes(parts: readonly Uint8Array[], length: number): Uint8Array {
  if (parts.length === 0) return new Uint8Array(0);
  if (parts.length === 1) return parts[0] as Uint8Array;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let text = "";
  for (let i = from; i < to; i += 1) text += String.fromCharCode(bytes[i] as number);
  return text;
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
