// 防的是：斜杠命令输出里的 ANSI 转义当成乱码显示。
import { describe, expect, it } from "vitest";
import { stripAnsi } from "../src/shared/ansi.ts";

describe("stripAnsi", () => {
  it("去掉颜色、光标和 OSC 超链接序列，保留文字", () => {
    expect(stripAnsi("\u001b[1m\u001b[36mContext\u001b[0m: 12%")).toBe("Context: 12%");
    expect(stripAnsi("a\u001b[2K\u001b[1Gb\u001b[?25lc")).toBe("abc");
    expect(stripAnsi("\u001b]8;;http://127.0.0.1:3000\u0007dash\u001b]8;;\u0007")).toBe("dash");
    expect(stripAnsi("plain 中文")).toBe("plain 中文");
  });
});
