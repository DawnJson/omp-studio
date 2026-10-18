// 防的是：结果优先的界面把结论放错位置——叙述当成结论、结论被当成过程藏起来、整轮没文字时显示空白。
// 用 fixtures/rpc 的真实回放（经主进程同一个 translateFrame）验证：结论文字 = fixture 里最后一条不带工具调用的 message_end。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTurns } from "../src/renderer/src/features/conversation/model.ts";
import { summarizeChanges } from "../src/renderer/src/features/conversation/tool-info.ts";
import { translateFrame } from "../src/main/tasks/translate.ts";
import type { AgentMessage, AssistantMessage, RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import {
  applyTranscriptEvent,
  emptyTranscript,
  type Transcript,
  type TranscriptEvent,
} from "../src/shared/transcript.ts";

const dir = path.join(import.meta.dirname, "..", "fixtures", "rpc");

function frames(name: string): RpcServerFrame[] {
  return readFileSync(path.join(dir, `${name}.ndjson`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): { kind: string; frame?: RpcServerFrame } => JSON.parse(line))
    .flatMap((line) => (line.kind === "out" && line.frame ? [line.frame] : []));
}

function replay(name: string, until?: (event: TranscriptEvent) => boolean): Transcript {
  let transcript = emptyTranscript();
  let at = 1000;
  for (const frame of frames(name)) {
    for (const event of translateFrame(frame, 1, at)) {
      if (until?.(event)) return transcript;
      transcript = applyTranscriptEvent(transcript, event);
      at += 10;
    }
  }
  return transcript;
}

const text = (message: AssistantMessage) =>
  message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
const hasTool = (message: AssistantMessage) => message.content.some((block) => block.type === "toolCall");

/** fixture 里每个助手 message_end，按出现顺序。 */
function finalAssistants(name: string): AssistantMessage[] {
  return frames(name).flatMap((frame): AssistantMessage[] =>
    frame.type === "message_end" && frame.message.role === "assistant" ? [frame.message] : [],
  );
}

const names = readdirSync(dir)
  .filter((file) => file.endsWith(".ndjson"))
  .map((file) => file.replace(".ndjson", ""));

describe.each(names)("回放 %s：结论与 fixture 的 message_end 一致", (name) => {
  it("结论文字等于最后一条不带工具调用的助手消息（没有就退回最后一条有文字的）", () => {
    const turns = buildTurns(replay(name));
    const assistants = finalAssistants(name);
    const plain = assistants.filter((message) => !hasTool(message) && text(message) !== "");
    const expected = plain.at(-1) ?? [...assistants].reverse().find((message) => text(message) !== "");
    const answered = turns.flatMap((turn) => (turn.answer ? [turn.answer] : []));
    if (expected === undefined) {
      expect(answered).toEqual([]);
      return;
    }
    expect(answered.at(-1)?.text).toBe(text(expected));
    expect(answered.at(-1)?.streaming).toBe(false);
  });

  it("叙述不在结论里重复：被选作结论的消息，它的文字不会再出现在过程的叙述里", () => {
    for (const turn of buildTurns(replay(name))) {
      if (!turn.answer) continue;
      expect(turn.steps.filter((step) => step.kind === "narration").map((step) => step.text)).not.toContain(
        turn.answer.text,
      );
    }
  });
});

describe("bash-tool 回放", () => {
  it("一轮：用户消息 + 一次 bash 调用（intent 原话）+ 结论", () => {
    const [turn, ...rest] = buildTurns(replay("bash-tool"));
    expect(rest).toEqual([]);
    expect(turn?.user?.text).toContain("echo omp-studio");
    expect(turn?.toolCalls).toBe(1);
    expect(turn?.failures).toBe(0);
    const tool = turn?.steps.find((step) => step.kind === "tool");
    expect(tool).toMatchObject({ kind: "tool", name: "bash", status: "done" });
    expect(tool?.kind === "tool" ? tool.intent : null).toMatch(/\S/);
    expect(tool?.kind === "tool" ? tool.output : null).toContain("omp-studio");
    expect(turn?.answer?.text).toContain("omp-studio");
    expect(turn?.runFinished).toBe(true);
  });

  it("流式中途：结论是正在流的那条，streaming 为 true；结束后变 false", () => {
    const mid = replay(
      "bash-tool",
      (event) => event.type === "message_end" && event.message.role === "assistant" && !hasTool(event.message),
    );
    const [turn] = buildTurns(mid);
    expect(turn?.answer).toMatchObject({ streaming: true });
    expect(turn?.liveKind).toBe("text");
    expect(turn?.runFinished).toBe(false);
  });
});

describe("simple-reply 回放", () => {
  it("没有工具调用的一轮：没有过程步骤，只有结论", () => {
    const [turn] = buildTurns(replay("simple-reply"));
    expect(turn?.steps).toEqual([]);
    expect(turn?.toolCalls).toBe(0);
    expect(turn?.answer?.text).toMatch(/1\+1\s*等于\s*2/);
  });
});

describe("turn-error 回放", () => {
  it("提示失败：没有结论，错误作为一项留在这一轮里", () => {
    const [turn] = buildTurns(replay("turn-error"));
    expect(turn?.answer).toBeNull();
    expect(turn?.extras.some((extra) => extra.kind === "prompt_error")).toBe(true);
  });
});

describe("叙述 / 结论启发式的边界", () => {
  const assistant = (content: AssistantMessage["content"]): AssistantMessage => ({
    role: "assistant",
    content,
    api: "x",
    provider: "p",
    model: "m",
    stopReason: "stop",
    timestamp: 1,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const history = (...messages: AgentMessage[]) =>
    applyTranscriptEvent(emptyTranscript(), { type: "history", messages });
  const user: AgentMessage = { role: "user", content: "做点事", timestamp: 1 };
  const call = { type: "toolCall" as const, id: "c1", name: "read", arguments: { path: "a.ts" } };

  it("以工具调用结尾的消息里的文字是叙述，最后不带工具调用的消息是结论", () => {
    const [turn] = buildTurns(
      history(
        user,
        assistant([{ type: "text", text: "我先看看文件。" }, call]),
        assistant([{ type: "text", text: "看完了，没问题。" }]),
      ),
    );
    expect(turn?.answer?.text).toBe("看完了，没问题。");
    expect(turn?.steps.map((step) => step.kind)).toEqual(["narration", "tool"]);
  });

  it("兜底：整轮没有不带工具调用的消息时，最后一条助手文字当结论", () => {
    const [turn] = buildTurns(history(user, assistant([{ type: "text", text: "我改完了，但还在收尾。" }, call])));
    expect(turn?.answer?.text).toBe("我改完了，但还在收尾。");
    expect(turn?.steps.map((step) => step.kind)).toEqual(["tool"]);
  });

  it('整轮没有任何助手文字：没有结论（界面写"没有得到结果"）', () => {
    const [turn] = buildTurns(history(user, assistant([call])));
    expect(turn?.answer).toBeNull();
    expect(turn?.hasAssistantOutput).toBe(true);
  });

  it("思考内容永不进结论；narration 标记的思考当作回答文字", () => {
    const [turn] = buildTurns(
      history(
        user,
        assistant([
          { type: "thinking", thinking: "内部推理" },
          { type: "text", text: "结论。" },
        ]),
      ),
    );
    expect(turn?.answer?.text).toBe("结论。");
    expect(turn?.steps.map((step) => step.kind)).toEqual(["thinking"]);
  });

  it("没变的轮沿用同一个对象，流式追加时已完成的轮不重渲染", () => {
    const before = history(user, assistant([{ type: "text", text: "第一轮。" }]));
    const first = buildTurns(before);
    const next = applyTranscriptEvent(before, {
      type: "history",
      messages: [
        user,
        assistant([{ type: "text", text: "第一轮。" }]),
        { role: "user", content: "再来", timestamp: 9 },
      ],
    });
    const second = buildTurns(next, first);
    expect(second).toHaveLength(2);
    expect(second[1]?.user?.text).toBe("再来");
  });
});

describe("改动文件汇总", () => {
  it("只统计成功的 edit/write；edit 取 details.diff，write 取 content 行数", () => {
    const changes = summarizeChanges([
      {
        name: "edit",
        args: { input: "[src/a.ts#1A2B]\nPUT 1.=1:\n+x" },
        status: "done",
        result: { details: { diff: "--- a\n+++ a\n-old\n+new1\n+new2" } },
      },
      { name: "write", args: { path: "b.txt", content: "l1\nl2\n" }, status: "done", result: {} },
      { name: "edit", args: { path: "bad.ts" }, status: "error", result: {} },
      { name: "bash", args: { command: "ls" }, status: "done", result: {} },
    ]);
    expect(changes).toEqual([
      { path: "src/a.ts", added: 2, removed: 1 },
      { path: "b.txt", added: 2, removed: 0 },
    ]);
  });
});

describe("空的思考块", () => {
  it("只有空白的思考内容不产生过程步骤", () => {
    const base = {
      api: "x",
      provider: "p",
      model: "m",
      stopReason: "stop" as const,
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const t = applyTranscriptEvent(emptyTranscript(), {
      type: "history",
      messages: [
        { role: "user", content: "x", timestamp: 1 },
        {
          ...base,
          role: "assistant",
          content: [
            { type: "thinking", thinking: " \n", thinkingSignature: "sig" },
            { type: "text", text: "好。" },
          ],
        },
      ],
    });
    const [turn] = buildTurns(t);
    expect(turn?.steps).toEqual([]);
    expect(turn?.answer?.text).toBe("好。");
  });
});
