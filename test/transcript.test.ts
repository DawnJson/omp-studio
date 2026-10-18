import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentMessage, AssistantContent, RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { applyTranscriptEvent, emptyTranscript, type AssistantDelta, type Transcript, type TranscriptEvent } from "../src/shared/transcript.ts";

const fixtures = ["simple-reply", "bash-tool"];

interface RecordedLine {
  kind: string;
  frame?: RpcServerFrame;
}

function readOutFrames(name: string): RpcServerFrame[] {
  const file = path.join(import.meta.dirname, "..", "fixtures", "rpc", `${name}.ndjson`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    // 录制文件是本仓库自己写的 NDJSON，每行的形状见 docs/architecture/rpc-replay.md。
    .map((line): RecordedLine => JSON.parse(line))
    .flatMap((line) => (line.kind === "out" && line.frame ? [line.frame] : []));
}

/** 假装主进程：把 omp 帧翻译成 TranscriptEvent（去掉 partial，不转发 toolcall_delta）。真正的翻译在任务运行时里。 */
function toEvents(frame: RpcServerFrame, at: number): TranscriptEvent[] {
  const key = (messageId: string | undefined) => `0:${messageId ?? "?"}`;
  switch (frame.type) {
    case "agent_start":
      return [{ type: "run_start", at }];
    case "agent_end":
      return [{ type: "run_end", at, yielded: frame.yielded ?? false }];
    case "message_start":
      return [{ type: "message_start", key: key(frame.messageId), message: frame.message, at }];
    case "message_update": {
      const { assistantMessageEvent: event } = frame;
      if (event.type === "toolcall_delta") return [];
      let delta: AssistantDelta;
      if (event.type === "done" || event.type === "error") delta = event;
      else {
        const { partial: _partial, ...rest } = event;
        delta = rest;
      }
      return [{ type: "message_delta", key: key(frame.messageId), delta }];
    }
    case "message_end":
      return [{ type: "message_end", key: key(frame.messageId), message: frame.message, at }];
    case "tool_execution_start":
      return [
        {
          type: "tool_start",
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          at,
          ...(frame.args !== undefined && { args: frame.args }),
          ...(frame.intent !== undefined && { intent: frame.intent }),
        },
      ];
    case "tool_execution_update":
      return [{ type: "tool_update", toolCallId: frame.toolCallId, partialResult: frame.partialResult }];
    case "tool_execution_end":
      return [{ type: "tool_end", toolCallId: frame.toolCallId, result: frame.result, isError: frame.isError ?? false, at }];
    default:
      return [];
  }
}

/** 比较流式累积出的内容和 omp 的最终内容：文本、思考、工具调用的 id/name/arguments。 */
function comparable(content: AssistantContent[]): unknown[] {
  return content.map((block) => {
    if (block.type === "toolCall") return { type: block.type, id: block.id, name: block.name, arguments: block.arguments };
    if (block.type === "text") return { type: block.type, text: block.text };
    if (block.type === "thinking") return { type: block.type, thinking: block.thinking };
    return block;
  });
}

function replay(name: string, onBeforeEnd: (before: Transcript, key: string, final: AgentMessage) => void): Transcript {
  let transcript = emptyTranscript();
  let at = 1000;
  for (const frame of readOutFrames(name)) {
    for (const event of toEvents(frame, at++)) {
      if (event.type === "message_end") onBeforeEnd(transcript, event.key, event.message);
      transcript = applyTranscriptEvent(transcript, event);
    }
  }
  return transcript;
}

describe.each(fixtures)("transcript reducer 回放 %s", (name) => {
  it("message_end 之后每条消息和 omp 的完整消息一致", () => {
    const finals = new Map<string, AgentMessage>();
    const transcript = replay(name, (_before, key, final) => finals.set(key, final));
    expect(finals.size).toBeGreaterThan(0);
    for (const [key, final] of finals) {
      const index = transcript.indexByKey[key];
      const item = index === undefined ? undefined : transcript.items[index];
      expect(item).toMatchObject({ kind: "message", streaming: false, message: final });
    }
  });

  it("只靠 delta 累积出的 assistant 内容在 message_end 之前就和最终内容一致（不依赖 message_end 覆盖）", () => {
    let checked = 0;
    replay(name, (before, key, final) => {
      if (final.role !== "assistant") return;
      const index = before.indexByKey[key];
      const item = index === undefined ? undefined : before.items[index];
      expect(item?.kind).toBe("message");
      if (item?.kind !== "message" || item.message.role !== "assistant") return;
      expect(comparable(item.message.content)).toEqual(comparable(final.content));
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("没有残留的流式状态：消息都结束、工具都完成、每轮都有结束时间", () => {
    const transcript = replay(name, () => {});
    for (const item of transcript.items) {
      if (item.kind === "message") expect(item.streaming).toBe(false);
    }
    for (const run of Object.values(transcript.tools)) expect(run.status).not.toBe("running");
    expect(transcript.runs.length).toBe(1);
    expect(transcript.runs[0]?.endedAt).not.toBeNull();
  });
});

describe("transcript reducer 边界", () => {
  it("bash 工具录制：一次工具调用记入当轮计数，结果来自 tool_execution_end", () => {
    const transcript = replay("bash-tool", () => {});
    expect(transcript.runs[0]?.toolCalls).toBe(1);
    const [run] = Object.values(transcript.tools);
    expect(run?.status).toBe("done");
    expect(run?.result).toMatchObject({ content: [{ type: "text", text: "omp-studio\n" }] });
  });

  it("history 载入历史消息后，后续事件接在它后面，键不冲突", () => {
    const user: AgentMessage = { role: "user", content: "hi", timestamp: 5 };
    let transcript = applyTranscriptEvent(emptyTranscript(), { type: "history", messages: [user] });
    transcript = applyTranscriptEvent(transcript, { type: "message_start", key: "0:msg-1", message: user, at: 10 });
    expect(transcript.items.map((item) => (item.kind === "message" ? item.key : item.kind))).toEqual(["h:0", "0:msg-1"]);
    expect(transcript.indexByKey).toEqual({ "h:0": 0, "0:msg-1": 1 });
  });

  it("tool_update 不重建消息列表（渲染进程靠引用相等跳过重绘）", () => {
    let transcript = replay("bash-tool", () => {});
    const items = transcript.items;
    transcript = applyTranscriptEvent(transcript, { type: "tool_update", toolCallId: Object.keys(transcript.tools)[0] ?? "", partialResult: "x" });
    expect(transcript.items).toBe(items);
  });

  it("prompt_result 失败时错误落成一项；成功和中止不产生", () => {
    let transcript = emptyTranscript();
    transcript = applyTranscriptEvent(transcript, { type: "prompt_result", promptId: "p1", status: "completed", at: 1 });
    transcript = applyTranscriptEvent(transcript, { type: "prompt_result", promptId: "p2", status: "aborted", at: 2 });
    expect(transcript.items).toEqual([]);
    transcript = applyTranscriptEvent(transcript, {
      type: "prompt_result",
      promptId: "p3",
      status: "error",
      error: { message: "boom", retryable: false },
      at: 3,
    });
    expect(transcript.items).toEqual([{ kind: "prompt_error", promptId: "p3", error: { message: "boom", retryable: false }, at: 3 }]);
  });
});
