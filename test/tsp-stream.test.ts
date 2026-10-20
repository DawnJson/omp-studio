import { describe, expect, it } from "vitest";
import { TspStreamParser, type TspStreamEvent } from "../src/main/tsp/stream.ts";
import { apc, loadTspFixture } from "./tsp-fixtures.ts";

/** 按块大小喂入字节，返回事件。 */
function parse(data: Uint8Array, chunkSize = data.length): TspStreamEvent[] {
  const events: TspStreamEvent[] = [];
  const parser = new TspStreamParser((event) => events.push(event));
  for (let at = 0; at < data.length; at += chunkSize) parser.write(data.subarray(at, at + chunkSize));
  return events;
}

/** `text` 事件的内容在不同分块下会被切成不同的段：比较时把相邻的合并。 */
function normalize(events: TspStreamEvent[]): TspStreamEvent[] {
  const out: TspStreamEvent[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (event.type === "text" && last?.type === "text")
      out[out.length - 1] = { type: "text", text: last.text + event.text };
    else out.push(event);
  }
  return out;
}

const bell = "\x07";

describe("TspStreamParser：APC", () => {
  it("在任意字节处断开都得到同样的消息（含被切开的多字节字符）", () => {
    // 真实录制：approval.jsonl 全部 omp → 终端消息，正文里有中文。
    const wire = Buffer.concat(
      loadTspFixture("approval")
        .filter((line) => line.dir === "out")
        .map((line) => apc(line.verb, JSON.stringify(line.body))),
    );
    const whole = parse(wire);
    expect(whole.filter((event) => event.type === "tsp")).toHaveLength(
      loadTspFixture("approval").filter((line) => line.dir === "out").length,
    );
    for (const size of [1, 2, 3, 7, 64, 1000]) expect(parse(wire, size)).toEqual(whole);
  });

  it("消息的动词、参数和正文：正文里的 ; 和 = 保持原样，参数段只在后面还有 ; 时才算", () => {
    const events = parse(
      Buffer.concat([
        apc("f", '{"sf":"s:1","note":"a=1;b=2"}'),
        apc("b", "QUJD", { id: "abc", mime: "image/png" }),
        // 正文刚好长得像参数但后面没有 ;：是正文。
        Buffer.from("\x1b_tsp;q;x=1\x1b\\"),
      ]),
    );
    expect(events).toEqual([
      { type: "tsp", verb: "f", params: {}, body: '{"sf":"s:1","note":"a=1;b=2"}' },
      { type: "tsp", verb: "b", params: { id: "abc", mime: "image/png" }, body: "QUJD" },
      { type: "tsp", verb: "q", params: {}, body: "x=1" },
    ]);
  });

  it("BEL 也能结束 APC（Tern 的解析器对所有字符串都认）", () => {
    expect(parse(Buffer.from(`\x1b_tsp;q;{"q":"hello"}${bell}`))).toEqual([
      { type: "tsp", verb: "q", params: {}, body: '{"q":"hello"}' },
    ]);
  });

  it("分块（c/m）：按字节拼接再解码，切点可以在 UTF-8 字符中间；第一块的参数保留", () => {
    const text = "你好，世界".repeat(5);
    const body = Buffer.from(JSON.stringify({ sf: "s:1", s: 3, ops: [["text", "m1", "append", text]] }));
    // 切在第一个汉字的第 2 个字节和第二个汉字的中间。
    const first = body.indexOf("你") + 1;
    const second = body.indexOf("好") + 2;
    const chunk = (part: Buffer, params: string) =>
      Buffer.concat([Buffer.from(`\x1b_tsp;f;${params}`), part, Buffer.from("\x1b\\")]);
    const wire = Buffer.concat([
      chunk(body.subarray(0, first), "id=x;c=k7;m=1;"),
      chunk(body.subarray(first, second), "c=k7;m=1;"),
      chunk(body.subarray(second), "c=k7;"),
    ]);
    const expected = [{ type: "tsp", verb: "f", params: { id: "x" }, body: body.toString("utf8") }];
    expect(parse(wire)).toEqual(expected);
    expect(parse(wire, 5)).toEqual(expected);
  });

  it("分块序列被别的 TSP 消息打断：序列作废并报告，打断它的消息照常处理", () => {
    const wire = Buffer.concat([
      Buffer.from('\x1b_tsp;f;c=k1;m=1;{"sf":"s:1"\x1b\\'),
      apc("f", '{"sf":"s:1","s":2,"ops":[]}'),
    ]);
    expect(parse(wire)).toEqual([
      { type: "chunk-dropped", verb: "f", chunk: "k1", reason: "interrupted" },
      { type: "tsp", verb: "f", params: {}, body: '{"sf":"s:1","s":2,"ops":[]}' },
    ]);
  });

  it("别的程序的 APC 和 DCS 丢弃，不打断后面的 TSP 消息", () => {
    expect(parse(Buffer.from('\x1b_Gi=1;AAAA\x1b\\\x1bPq1;2\x1b\\\x1b_tsp;o;{"id":"s:1"}\x1b\\'))).toEqual([
      { type: "tsp", verb: "o", params: {}, body: '{"id":"s:1"}' },
    ]);
  });
});

describe("TspStreamParser：OSC、DA1 和其余字节", () => {
  it("标题（OSC 0 / 2，BEL 或 ST 结尾）", () => {
    expect(parse(Buffer.from(`\x1b]0;one${bell}\x1b]2;two\x1b\\\x1b]1;icon${bell}`))).toEqual([
      { type: "title", title: "one" },
      { type: "title", title: "two" },
    ]);
  });

  it("OSC 1337 SetUserVar：值是 base64（路径带中文和空格）", () => {
    const file = "C:\\Users\\某人\\.omp\\agent\\sessions\\项目 一\\a.jsonl";
    const b64 = Buffer.from(file).toString("base64");
    const events = parse(Buffer.from(`\x1b]1337;SetUserVar=omp_session_file=${b64}${bell}`), 3);
    expect(events).toEqual([{ type: "user-var", name: "omp_session_file", value: file }]);
  });

  it("通知：OSC 9；OSC 99 的标题和正文可以分两条到达；OSC 9;4 是进度条不算通知", () => {
    const events = parse(
      Buffer.from(
        `\x1b]9;done${bell}\x1b]9;4;1;50${bell}\x1b]99;i=1:d=0:p=title;omp: Complete\x1b\\\x1b]99;i=1:d=1:p=body;all good\x1b\\`,
      ),
    );
    expect(events).toEqual([
      { type: "notify", title: "", body: "done" },
      { type: "notify", title: "omp: Complete", body: "all good" },
    ]);
  });

  it("DA1 查询（ESC [ c、ESC [ 0 c）；DA2、私有模式和别的 CSI 不是", () => {
    const events = parse(Buffer.from("\x1b[c\x1b[0c\x1b[>c\x1b[?1c\x1b[1;2H\x1b[31m\x1b(B\x1b[?25l"));
    expect(events.filter((event) => event.type === "da1")).toHaveLength(2);
  });

  it("其余 ANSI 丢弃，只剩普通文字；字符串被新的转义中止后从那个转义继续", () => {
    const events = normalize(parse(Buffer.from("err: \x1b[31mbad\x1b[0m\r\n\x1b]0;lost\x1b[c\x1b]0;kept\x07"), 1));
    expect(events).toEqual([{ type: "text", text: "err: bad\r\n" }, { type: "da1" }, { type: "title", title: "kept" }]);
  });
});
