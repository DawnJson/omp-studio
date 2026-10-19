// 把对话流（扁平的 items）整理成"轮"：每轮 = 一条用户消息 + 过程 + 结论 + 提示。纯函数，不碰 DOM，test/conversation-model.test.ts 用 fixture 回放验证。
// 叙述/结论启发式（spec 4.9 / 裁决 Calm-2）：以工具调用结尾的消息里的文字是叙述，进过程；
// 最后一条不带工具调用的消息是结论；整轮没有这样的消息时，把最后一条有文字的助手消息当结论；整轮没有文字才是"没有得到结果"。
import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  NotifyType,
  PromptError,
  ToolResultMessage,
} from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { RunSpan, Transcript, TranscriptItem, ToolRun } from "../../../../shared/transcript.ts";
import { resultText, summarizeChanges, type FileChange } from "./tool-info.ts";

type MessageItem = Extract<TranscriptItem, { kind: "message" }>;

export interface UserBubble {
  key: string;
  text: string;
  images: ImageContent[];
  at: number;
}

export interface ToolStep {
  kind: "tool";
  key: string;
  toolCallId: string;
  name: string;
  intent: string | null;
  args: unknown;
  status: "running" | "done" | "error";
  /** 输出文字（运行中取最近一次部分结果）。 */
  output: string | null;
  result: unknown;
  startedAt: number | null;
  endedAt: number | null;
}

export type Step =
  ToolStep | { kind: "narration"; key: string; text: string } | { kind: "thinking"; key: string; text: string };

export type Extra =
  | { kind: "notice"; key: string; level: NotifyType; message: string }
  | { kind: "command_output"; key: string; text: string }
  | { kind: "compaction"; key: string; phase: "start" | "end" }
  | { kind: "retry"; key: string; phase: "start" | "end" }
  | { kind: "prompt_error"; key: string; error: PromptError | null }
  | { kind: "model_error"; key: string; message: string }
  /** 用户用 @ 附带的文件（fileMention 消息）：只记路径，内容不进界面。 */
  | { kind: "file_mention"; key: string; paths: string[] }
  /** 用户的 `!命令` 及其输出（bashExecution 消息）。 */
  | {
      kind: "shell";
      key: string;
      command: string;
      output: string;
      exitCode: number | null;
      cancelled: boolean;
      truncated: boolean;
    };

export interface Answer {
  key: string;
  text: string;
  streaming: boolean;
}

export interface Turn {
  key: string;
  user: UserBubble | null;
  steps: Step[];
  answer: Answer | null;
  extras: Extra[];
  /** 助手产出过内容（文字或工具调用）：没有结论时用来决定要不要写"没有得到结果"。 */
  hasAssistantOutput: boolean;
  /** 正在流式的助手消息当前在写什么（一行实时状态用）；没有流式消息为 null。 */
  liveKind: "thinking" | "text" | "tool" | null;
  startedAt: number;
  /** 本轮最后一次活动的时间（工具结束、消息结束、提示）。 */
  endedAt: number;
  toolCalls: number;
  failures: number;
  subagents: number;
  /** 这轮所属的 run 已结束，或没有 run 记录（历史）。 */
  runFinished: boolean;
  /** 助手消息里的 model 与上一轮不同时的新模型名；否则 null。 */
  modelSwitch: string | null;
  changes: FileChange[];
  /** 复用判断：这一轮依赖的所有 item/tool 引用，全部没变就沿用上一次的 Turn 对象。 */
  deps: unknown[];
}

function userText(message: AgentMessage): { text: string; images: ImageContent[] } | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return { text: message.content, images: [] };
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  const images = message.content.flatMap((block) => (block.type === "image" ? [block] : []));
  return { text, images };
}

export function toolFromRun(run: ToolRun, key: string): ToolStep {
  const live = run.status === "running";
  return {
    kind: "tool",
    key,
    toolCallId: run.toolCallId,
    name: run.toolName,
    intent: run.intent,
    args: run.args,
    status: run.status,
    output: resultText(live ? run.partialResult : run.result),
    result: run.result,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

function toolFromResultMessage(
  call: { id: string; name: string; arguments: unknown; intent?: string | undefined },
  result: ToolResultMessage | undefined,
  at: number,
  streaming: boolean,
): ToolStep {
  return {
    kind: "tool",
    key: `tool:${call.id}`,
    toolCallId: call.id,
    name: call.name,
    intent: call.intent ?? null,
    args: call.arguments,
    // 没有结果消息：消息还在流式时是还没开始执行；否则是历史里没留下结果（被中断），按完成处理。
    status: result ? (result.isError ? "error" : "done") : streaming ? "running" : "done",
    output: result ? resultText({ content: result.content }) : null,
    result: result ? { content: result.content, details: result.details } : undefined,
    startedAt: null,
    endedAt: at,
  };
}

function textOf(message: AssistantMessage): string {
  return message.content
    .flatMap((block) =>
      block.type === "text" ? [block.text] : block.type === "thinking" && block.narration ? [block.thinking] : [],
    )
    .join("\n\n")
    .trim();
}

export function lastBlockKind(message: AssistantMessage): "thinking" | "text" | "tool" | null {
  const block = message.content[message.content.length - 1];
  if (!block) return null;
  return block.type === "toolCall"
    ? "tool"
    : block.type === "text"
      ? "text"
      : block.type === "thinking"
        ? "thinking"
        : null;
}

function hasToolCall(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === "toolCall");
}

function groupItems(items: readonly TranscriptItem[]): TranscriptItem[][] {
  const groups: TranscriptItem[][] = [];
  for (const item of items) {
    const startsTurn =
      item.kind === "message" &&
      ((item.message.role === "user" && item.message.synthetic !== true) || item.message.role === "bashExecution");
    if (startsTurn || groups.length === 0) groups.push([item]);
    else (groups[groups.length - 1] as TranscriptItem[]).push(item);
  }
  return groups;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

function buildTurn(
  group: readonly TranscriptItem[],
  transcript: Transcript,
  index: number,
  previousModel: string | null,
): Turn {
  const first = group[0] as TranscriptItem;
  const userItem = first.kind === "message" && first.message.role === "user" ? first : null;
  const user = userItem ? userText(userItem.message) : null;

  const messages = group.filter((item): item is MessageItem => item.kind === "message");
  const resultsById = new Map<string, ToolResultMessage>();
  for (const item of messages)
    if (item.message.role === "toolResult") resultsById.set(item.message.toolCallId, item.message);
  const assistants = messages.filter(
    (item): item is MessageItem & { message: AssistantMessage } => item.message.role === "assistant",
  );

  // 结论：最后一条不带工具调用的消息；没有就退回最后一条有文字的。流式中的消息还没定型，先不算结论。
  const settled = assistants.filter((item) => !item.streaming);
  const withoutTools = settled.filter((item) => !hasToolCall(item.message) && textOf(item.message) !== "");
  const conclusionItem =
    withoutTools[withoutTools.length - 1] ?? [...settled].reverse().find((item) => textOf(item.message) !== "") ?? null;
  const lastAssistant = assistants[assistants.length - 1];
  const live =
    lastAssistant?.streaming && textOf(lastAssistant.message) !== "" && !hasToolCall(lastAssistant.message)
      ? lastAssistant
      : null;
  const answerItem = live ?? conclusionItem;
  const answer: Answer | null = answerItem
    ? { key: answerItem.key, text: textOf(answerItem.message), streaming: answerItem.streaming }
    : null;

  const steps: Step[] = [];
  const seenTools = new Set<string>();
  let toolCalls = 0;
  let failures = 0;
  let endedAt = first.kind === "message" ? (first.endedAt ?? first.at) : first.at;
  const extras: Extra[] = [];
  let model: string | null = null;

  group.forEach((item, position) => {
    if (item.kind === "notice")
      extras.push({ kind: "notice", key: `n${position}`, level: item.level, message: item.message });
    else if (item.kind === "command_output")
      extras.push({ kind: "command_output", key: `c${position}`, text: item.text });
    else if (item.kind === "status_line")
      extras.push({
        kind: item.statusKind === "compaction" ? "compaction" : "retry",
        key: `s${position}`,
        phase: item.phase,
      });
    else if (item.kind === "prompt_error")
      extras.push({ kind: "prompt_error", key: `e${position}`, error: item.error });
    if (item.kind !== "message") {
      endedAt = Math.max(endedAt, item.at);
      return;
    }
    endedAt = Math.max(endedAt, item.endedAt ?? item.at);
    const message = item.message;
    if (message.role === "assistant") {
      model ??= message.model;
      if (message.stopReason === "error" && message.errorMessage && !item.streaming) {
        extras.push({ kind: "model_error", key: `m${position}`, message: message.errorMessage });
      }
      const isConclusion = answerItem !== null && item.key === answerItem.key;
      message.content.forEach((block, blockIndex) => {
        const key = `${item.key}#${blockIndex}`;
        if (block.type === "thinking" && !block.narration && block.thinking.trim() !== "")
          steps.push({ kind: "thinking", key, text: block.thinking });
        else if ((block.type === "text" || (block.type === "thinking" && block.narration)) && !isConclusion) {
          const text = block.type === "text" ? block.text : block.thinking;
          if (text.trim() !== "") steps.push({ kind: "narration", key, text: text.trim() });
        } else if (block.type === "toolCall" && !seenTools.has(block.id)) {
          seenTools.add(block.id);
          const run = transcript.tools[block.id];
          const step = run
            ? toolFromRun(run, `tool:${block.id}`)
            : toolFromResultMessage(block, resultsById.get(block.id), item.endedAt ?? item.at, item.streaming);
          steps.push(step);
        }
      });
    } else if (message.role === "bashExecution") {
      // 用户的 `!命令`（模型自己的 bash 是 toolCall，不走这条）：作为命令块单独成块，不并进上一轮的过程。
      extras.push({
        kind: "shell",
        key: `b${position}`,
        command: message.command,
        output: message.output,
        exitCode: message.exitCode ?? null,
        cancelled: message.cancelled,
        truncated: message.truncated,
      });
    } else if (message.role === "compactionSummary") {
      extras.push({ kind: "compaction", key: `k${position}`, phase: "end" });
    } else if (message.role === "fileMention") {
      extras.push({ kind: "file_mention", key: `f${position}`, paths: message.files.map((file) => file.path) });
    }
  });

  // 实时工具（还没进入任何助手消息的 tool_execution_*）也计入：toolcall 块先于执行出现，这里只补漏。
  for (const step of steps) {
    if (step.kind !== "tool") continue;
    toolCalls += 1;
    if (step.status === "error") failures += 1;
    if (step.endedAt !== null) endedAt = Math.max(endedAt, step.endedAt);
  }

  const toolsForChanges = steps.flatMap((step) =>
    step.kind === "tool" ? [{ name: step.name, args: step.args, status: step.status, result: step.result }] : [],
  );
  const startedAt = userItem?.at ?? first.at;
  const deps: unknown[] = [index, previousModel, ...group, ...[...seenTools].map((id) => transcript.tools[id])];
  return {
    key: userItem?.key ?? `turn:${index}`,
    user: user && userItem ? { key: userItem.key, ...user, at: userItem.at } : null,
    steps,
    answer,
    extras,
    hasAssistantOutput: assistants.length > 0,
    liveKind: lastAssistant?.streaming ? lastBlockKind(lastAssistant.message) : null,
    startedAt,
    endedAt,
    toolCalls,
    failures,
    subagents: 0,
    runFinished: true,
    modelSwitch: model !== null && previousModel !== null && model !== previousModel ? model : null,
    changes: summarizeChanges(toolsForChanges),
    deps,
  };
}

function runForTurns(turns: Turn[], runs: readonly RunSpan[]): void {
  // 每个 run 归给"第一个在它开始之后出现的用户消息"所在的轮（agent_start 先于用户消息回显到达）。
  runs.forEach((run) => {
    const turn = turns.find((candidate) => candidate.user !== null && candidate.user.at >= run.startedAt);
    if (!turn) return;
    turn.subagents += run.subagents;
    turn.runFinished = run.endedAt !== null;
    if (run.endedAt !== null) turn.endedAt = Math.max(turn.endedAt, run.endedAt);
  });
}

/** 整理对话流。传入上一次的结果可以复用没变的轮（对象引用不变，React.memo 才有意义）。 */
export function buildTurns(transcript: Transcript, previous: readonly Turn[] = []): Turn[] {
  const previousByKey = new Map(previous.map((turn) => [turn.key, turn]));
  let previousModel: string | null = null;
  const turns = groupItems(transcript.items).map((group, index) => {
    const turn = buildTurn(group, transcript, index, previousModel);
    const model = group.flatMap((item) =>
      item.kind === "message" && item.message.role === "assistant" ? [item.message.model] : [],
    )[0];
    if (model) previousModel = model;
    return turn;
  });
  runForTurns(turns, transcript.runs);
  return turns.map((turn) => {
    const old = previousByKey.get(turn.key);
    const unchanged =
      old !== undefined &&
      sameDeps(old.deps, turn.deps) &&
      old.subagents === turn.subagents &&
      old.runFinished === turn.runFinished &&
      old.endedAt === turn.endedAt;
    return unchanged ? old : turn;
  });
}
