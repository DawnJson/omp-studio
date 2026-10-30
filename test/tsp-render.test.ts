import { describe, expect, it } from "vitest";
import { parseAnsi, parseAnsiStream, type AnsiParse } from "../src/renderer/src/features/tsp/ansi.ts";
import { changedRange, parseDiff, splitRows } from "../src/renderer/src/features/tsp/diff-parse.ts";
import {
  extentToCss,
  formatCost,
  formatCount,
  formatElapsed,
  formatRate,
  gateKeyHint,
  keycapLabel,
} from "../src/renderer/src/features/tsp/fmt.ts";
import { tokenizeCommand } from "../src/renderer/src/features/tsp/shell-tokens.ts";
import { semanticOf, spanClass, spanTokens, cleanGlyphs } from "../src/renderer/src/features/tsp/span-tokens.ts";
import { planTspBatch } from "../src/renderer/src/features/tsp/tsp-sync.ts";

const batch = (firstSeq: number, count: number) => ({
  firstSeq,
  messages: Array.from({ length: count }, () => ({ verb: "x" as const, body: { id: "s:1", keep: true } })),
});

describe("planTspBatch（序号不连续就重新同步）", () => {
  it("没有镜像的任务不接收", () => {
    expect(planTspBatch(undefined, batch(1, 3))).toEqual({ kind: "ignore" });
  });

  it("紧接着的批次从头应用；和快照重叠的前缀跳过", () => {
    expect(planTspBatch(4, batch(5, 2))).toEqual({ kind: "apply", skip: 0 });
    expect(planTspBatch(4, batch(3, 4))).toEqual({ kind: "apply", skip: 2 });
  });

  it("已经全部应用过的批次忽略，中间丢了帧的要重新拉快照", () => {
    expect(planTspBatch(4, batch(1, 4))).toEqual({ kind: "ignore" });
    expect(planTspBatch(4, batch(7, 1))).toEqual({ kind: "resync" });
  });
});

describe("elapsed 的显示", () => {
  it("short：不到一分钟带十分位（向下取整），再大按分秒 / 时分", () => {
    expect(formatElapsed(12_345)).toBe("12.3s");
    expect(formatElapsed(59_999)).toBe("59.9s");
    expect(formatElapsed(245_000)).toBe("4m 05s");
    expect(formatElapsed(3_723_000)).toBe("1h 02m");
  });

  it("clock：0:12、4:05、1:02:03；负数按 0", () => {
    expect(formatElapsed(12_000, "clock")).toBe("0:12");
    expect(formatElapsed(245_000, "clock")).toBe("4:05");
    expect(formatElapsed(3_723_000, "clock")).toBe("1:02:03");
    expect(formatElapsed(-5000)).toBe("0.0s");
  });

  it("seconds：不到一分钟只到整秒，再大同 short", () => {
    expect(formatElapsed(4_999, "seconds")).toBe("4s");
    expect(formatElapsed(65_000, "seconds")).toBe("1m 05s");
    expect(formatElapsed(-5000, "seconds")).toBe("0s");
  });
});

describe("数字格式", () => {
  it("rate / 计数 / 费用", () => {
    expect(formatRate(42.26, "tok/s")).toBe("42.3 tok/s");
    expect(formatRate(1234.4)).toBe("1234");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(12_345)).toBe("12K");
    expect(formatCount(1_234_567)).toBe("1.2M");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.42)).toBe("$0.42");
  });

  it("键帽：修饰键用符号，单字符和功能键大写", () => {
    expect(keycapLabel("ctrl")).toBe("⌃");
    expect(keycapLabel("Escape")).toBe("esc");
    expect(keycapLabel("o")).toBe("O");
    expect(keycapLabel("f5")).toBe("F5");
    expect(keycapLabel("fn")).toBe("fn");
  });

  it("门和弹层的快捷键提示：Windows 键名，不用 mac 符号", () => {
    expect(gateKeyHint(["ctrl", "enter"])).toBe("Ctrl+Enter");
    expect(gateKeyHint(["alt", "h"])).toBe("Alt+H");
    expect(gateKeyHint(["escape"])).toBe("Esc");
    expect(gateKeyHint(["shift", "tab"])).toBe("Shift+Tab");
  });

  it("extent：ch / lines 按字符和行高算，小数是比例，像素和其它写法忽略", () => {
    expect(extentToCss("40ch")).toBe("calc(40 * var(--tsp-cw))");
    expect(extentToCss("10lines")).toBe("calc(10 * var(--tsp-lh))");
    expect(extentToCss(0.5)).toBe("50%");
    expect(extentToCss("10px")).toBeUndefined();
    expect(extentToCss(-1)).toBeUndefined();
  });
});

describe("span 样式 token", () => {
  it("omp 主题 token 按规范表落到语义 token；未知 token 丢弃", () => {
    expect(spanTokens("statusLineGitDirty")).toEqual(["warning"]);
    expect(spanTokens("toolTitle strong")).toEqual(["strong"]);
    expect(spanTokens("muted statusLineUntracked syntaxNumber bogus")).toEqual(["muted", "num"]);
    expect(spanTokens("text userMessageText")).toEqual([]);
    expect(spanClass("dim mono")).toBe("tsp-t-dim tsp-t-mono");
    expect(spanClass("")).toBeUndefined();
    expect(semanticOf("toolDiffAdded")).toBe("ins");
    expect(semanticOf("nope")).toBeNull();
  });

  it("私有区图标字符不画", () => {
    expect(cleanGlyphs("a\uF00Eb\u{F0001}c")).toBe("abc");
    expect(cleanGlyphs("\u{F12B7} suspends")).toBe("Esc suspends");
  });
});

describe("parseAnsi", () => {
  it("SGR 颜色和样式切成片段，换行分行，末尾换行不产生空行", () => {
    const lines = parseAnsi("a\u001b[31mred\u001b[0m b\nnext\n");
    expect(lines).toEqual([
      [{ text: "a" }, { text: "red", fg: "var(--tsp-ansi-1)" }, { text: " b" }],
      [{ text: "next" }],
    ]);
    expect(parseAnsi("\u001b[1;32mok\u001b[0m")[0]).toEqual([{ text: "ok", fg: "var(--tsp-ansi-2)", bold: true }]);
  });

  it("256 色和真彩色给原始色值", () => {
    expect(parseAnsi("\u001b[38;2;1;2;3mx")[0]?.[0]?.fg).toBe("rgb(1, 2, 3)");
    expect(parseAnsi("\u001b[38;5;196mx")[0]?.[0]?.fg).toBe("rgb(255, 0, 0)");
    expect(parseAnsi("\u001b[38;5;9mx")[0]?.[0]?.fg).toBe("var(--tsp-ansi-9)");
  });

  it("\\r 回到行首覆盖，进度条只留最后一次；\\b 退格", () => {
    expect(parseAnsi("hello\rHE")[0]).toEqual([{ text: "HEllo" }]);
    expect(parseAnsi("10%\r20%\r30%")[0]).toEqual([{ text: "30%" }]);
    expect(parseAnsi("ab\bc")[0]).toEqual([{ text: "ac" }]);
  });

  it("OSC 8 超链接", () => {
    const [line] = parseAnsi("see \u001b]8;;https://x.test/a\u001b\\link\u001b]8;;\u001b\\ now");
    expect(line).toEqual([{ text: "see " }, { text: "link", href: "https://x.test/a" }, { text: " now" }]);
  });

  it("其它控制序列丢弃，不留乱码", () => {
    expect(parseAnsi("\u001b[2Jx\u001b[?25l")[0]).toEqual([{ text: "x" }]);
  });

  it("parseAnsiStream：逐字追加的每个前缀都和整段解析相同，已结束的行复用同一个数组", () => {
    const log = [
      "\u001b[1;32mok\u001b[0m line 1\n",
      "plain\twith tab\n",
      "10%\r20%\r\u001b[33m30%\u001b[0m\n",
      "erase\u001b[2K new\n",
      "\u001b]8;;https://x.test/a\u001b\\li\nnk\u001b]8;;\u001b\\ after\n",
      "\u001b]8;;https://y.test\u0007bel link\u001b]8;;\u0007\n",
      "open osc \u001b]8;;https://z.test/\nspans\nlines\u0007 closed\n",
      "\u001b[38;5;196mred\u001b[38;2;1;2;3m rgb\n\n",
      "\u001b(Bdropped\u001bMx\bY 中文😀\n",
    ].join("");
    let state: AnsiParse | null = null;
    for (let end = 0; end <= log.length; end += 1) {
      const prefix = log.slice(0, end);
      state = parseAnsiStream(state, prefix);
      expect(state.lines).toEqual(parseAnsi(prefix));
    }
    const first = state!.lines[0];
    state = parseAnsiStream(state, `${log}more\n`);
    expect(state.lines[0]).toBe(first);
    // 不是延长：整段重解析。
    expect(parseAnsiStream(state, "x\ny").lines).toEqual(parseAnsi("x\ny"));
  });
});

describe("tokenizeCommand", () => {
  it("程序词 / 选项 / 运算符 / 字符串 / 变量", () => {
    const kinds = (source: string) =>
      tokenizeCommand(source)
        .filter((token) => token.text.trim() !== "")
        .map((token) => `${token.kind}:${token.text}`);
    expect(kinds("python -m pytest -q 2>&1 | tail -20")).toEqual([
      "cmd:python",
      "flag:-m",
      "text:pytest",
      "flag:-q",
      "op:2>&1",
      "op:|",
      "cmd:tail",
      "flag:-20",
    ]);
    expect(kinds('echo "hi there" $HOME && ls')).toEqual([
      "cmd:echo",
      'str:"hi there"',
      "var:$HOME",
      "op:&&",
      "cmd:ls",
    ]);
  });

  it("拼回去和原文一样", () => {
    const source = "FOO=1 cargo build --release 2>&1 | tee 'a b.log'";
    expect(
      tokenizeCommand(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
  });
});

describe("diff", () => {
  const patch = "@@ -1,2 +1,2 @@ def f\n a\n-b = 1\n+b = 2\n";

  it("统一 diff → 带新旧行号的行", () => {
    const [hunk] = parseDiff(patch);
    expect(hunk).toMatchObject({ oldStart: 1, newStart: 1, oldCount: 2, newCount: 2, fn: "def f" });
    expect(hunk?.lines).toEqual([
      { kind: "ctx", text: "a", old: 1, new: 1 },
      { kind: "del", text: "b = 1", old: 2, new: null },
      { kind: "add", text: "b = 2", old: null, new: 2 },
    ]);
  });

  it("CRLF 的补丁与 LF 结果相同，行尾不留 \\r", () => {
    expect(parseDiff(patch.replaceAll("\n", "\r\n"))).toEqual(parseDiff(patch));
  });

  it("没有 @@ 头的文本当成一个 hunk，--- / +++ 头忽略", () => {
    const [hunk] = parseDiff("--- a/x\n+++ b/x\n+new\n-old");
    expect(hunk?.lines.map((l) => l.kind)).toEqual(["add", "del"]);
  });

  it("成对的删/增行只强调改动的那段；几乎整行重写不强调", () => {
    expect(changedRange("let x = 1;", "let x = 2;")).toEqual([
      { from: 8, to: 9 },
      { from: 8, to: 9 },
    ]);
    expect(changedRange("abcdef", "uvwxyz")).toBeNull();
  });

  it("并排：一段删和随后的增按顺序配对，多出来的一侧留空", () => {
    const [hunk] = parseDiff("@@ -1,3 +1,2 @@\n-a\n-b\n-c\n+x\n+y\n");
    const rows = splitRows(hunk!.lines);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["a", "x"],
      ["b", "y"],
      ["c", null],
    ]);
  });
});
