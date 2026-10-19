// 防的是：斜杠命令输出里的 ANSI 转义当成乱码显示；@ 附带文件的 fileMention 消息在对话流里不可见。
import { describe, expect, it } from "vitest";
import { buildTurns } from "../src/renderer/src/features/conversation/model.ts";
import { translateFrame } from "../src/main/tasks/translate.ts";
import { stripAnsi } from "../src/shared/ansi.ts";
import type { RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { applyTranscriptEvent, emptyTranscript } from "../src/shared/transcript.ts";

describe("stripAnsi", () => {
  it("去掉颜色、光标和 OSC 超链接序列，保留文字", () => {
    expect(stripAnsi("\u001b[1m\u001b[36mContext\u001b[0m: 12%")).toBe("Context: 12%");
    expect(stripAnsi("a\u001b[2K\u001b[1Gb\u001b[?25lc")).toBe("abc");
    expect(stripAnsi("\u001b]8;;http://127.0.0.1:3000\u0007dash\u001b]8;;\u0007")).toBe("dash");
    expect(stripAnsi("plain 中文")).toBe("plain 中文");
  });

  it("command_output 在翻译边界就已干净", () => {
    const frame = { type: "command_output", text: "\u001b[32mok\u001b[0m" } as RpcServerFrame;
    expect(translateFrame(frame, 1, 5)).toEqual([{ type: "command_output", text: "ok", at: 5 }]);
  });
});

describe("fileMention", () => {
  it("映射成一条 file_mention 提示，按对话流顺序落在所属轮", () => {
    const frames = [
      {
        type: "message_start",
        messageId: "u1",
        message: { role: "user", content: "看看 @a.py", timestamp: 1 },
      },
      {
        type: "message_start",
        messageId: "f1",
        message: {
          role: "fileMention",
          files: [
            { path: "a.py", content: "print(1)" },
            { path: "src/b.ts", content: "", skippedReason: "tooLarge" },
          ],
          timestamp: 2,
        },
      },
    ] as RpcServerFrame[];
    let transcript = emptyTranscript();
    let at = 10;
    for (const frame of frames)
      for (const event of translateFrame(frame, 1, at++)) transcript = applyTranscriptEvent(transcript, event);
    const turns = buildTurns(transcript);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.extras).toEqual([{ kind: "file_mention", key: "f1", paths: ["a.py", "src/b.ts"] }]);
  });
});
