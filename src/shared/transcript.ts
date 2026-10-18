// 对话流的事件类型和 reducer。主进程用它维护每个任务的权威快照，渲染进程用它增量重建（local arch 3.3）。
// 只放类型和纯函数：不碰 Node/DOM；更新不可变，未改动的部分结构共享。
import type {
  AgentMessage,
  AssistantContent,
  AssistantMessage,
  AssistantMessageEvent,
  NotifyType,
  PromptError,
  PromptStatus,
  SubagentLifecycleStatus,
} from "./omp-wire/rpc-wire.generated.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 去掉 partial 的流式增量；toolcall_delta 主进程不转发（参数在 toolcall_end 里完整给出）。 */
export type AssistantDelta = DistributiveOmit<Exclude<AssistantMessageEvent, { type: "toolcall_delta" }>, "partial">;

export type TranscriptEvent =
  | { type: "history"; messages: AgentMessage[] }
  | { type: "run_start"; at: number }
  | { type: "run_end"; at: number; yielded: boolean }
  | { type: "message_start"; key: string; message: AgentMessage; at: number }
  | { type: "message_delta"; key: string; delta: AssistantDelta }
  | { type: "message_end"; key: string; message: AgentMessage; at: number }
  | { type: "tool_start"; toolCallId: string; toolName: string; args?: unknown; intent?: string; at: number }
  | { type: "tool_update"; toolCallId: string; partialResult: unknown }
  | { type: "tool_end"; toolCallId: string; result?: unknown; isError: boolean; at: number }
  | { type: "subagent"; id: string; status: SubagentLifecycleStatus; at: number }
  | { type: "prompt_result"; promptId: string; status: PromptStatus; error?: PromptError; at: number }
  | { type: "settled"; at: number }
  | { type: "notice"; level: NotifyType; message: string; at: number }
  | { type: "command_output"; text: string; at: number }
  | { type: "status_line"; kind: "compaction" | "retry"; phase: "start" | "end"; at: number };

export type TranscriptItem =
  | {
      kind: "message";
      key: string;
      message: AgentMessage;
      /** assistant 消息在 message_end（或 done/error）之前为 true；其他角色恒为 false。 */
      streaming: boolean;
      /** 开始时间（主进程接收时间；历史消息取消息自带的 timestamp）。 */
      at: number;
      endedAt: number | null;
    }
  | { kind: "notice"; level: NotifyType; message: string; at: number }
  | { kind: "command_output"; text: string; at: number }
  | { kind: "status_line"; statusKind: "compaction" | "retry"; phase: "start" | "end"; at: number }
  /** prompt_result 的 status 为 error：错误作为一项落在发生的位置。 */
  | { kind: "prompt_error"; promptId: string; error: PromptError | null; at: number };

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  args: unknown;
  intent: string | null;
  status: "running" | "done" | "error";
  /** 最近一次 tool_execution_update 的部分结果。 */
  partialResult: unknown;
  result: unknown;
  startedAt: number;
  endedAt: number | null;
}

/** 一轮（agent_start → agent_end）的时间段和计数，供"已工作 X 分 · N 次工具调用 · M 个子代理"。 */
export interface RunSpan {
  startedAt: number;
  endedAt: number | null;
  yielded: boolean;
  toolCalls: number;
  subagents: number;
}

export interface Transcript {
  /** 显示顺序。 */
  items: TranscriptItem[];
  /** 消息 key → items 下标。 */
  indexByKey: Record<string, number>;
  /** toolCallId → 执行情况。 */
  tools: Record<string, ToolRun>;
  runs: RunSpan[];
}

export function emptyTranscript(): Transcript {
  return { items: [], indexByKey: {}, tools: {}, runs: [] };
}

function appendItem(t: Transcript, item: TranscriptItem): Transcript {
  return { ...t, items: [...t.items, item] };
}

function upsertMessage(t: Transcript, item: Extract<TranscriptItem, { kind: "message" }>): Transcript {
  const index = t.indexByKey[item.key];
  if (index === undefined) {
    return { ...t, items: [...t.items, item], indexByKey: { ...t.indexByKey, [item.key]: t.items.length } };
  }
  const items = t.items.slice();
  items[index] = item;
  return { ...t, items };
}

function messageAt(t: Transcript, key: string): Extract<TranscriptItem, { kind: "message" }> | undefined {
  const index = t.indexByKey[key];
  const item = index === undefined ? undefined : t.items[index];
  return item?.kind === "message" ? item : undefined;
}

function withRun(t: Transcript, update: (run: RunSpan) => RunSpan): Transcript {
  const last = t.runs[t.runs.length - 1];
  if (!last) return t;
  return { ...t, runs: [...t.runs.slice(0, -1), update(last)] };
}

function setBlock(content: AssistantContent[], index: number, block: AssistantContent): AssistantContent[] {
  const next = content.slice();
  while (next.length < index) next.push({ type: "text", text: "" });
  next[index] = block;
  return next;
}

function applyAssistantDelta(message: AssistantMessage, delta: AssistantDelta): AssistantMessage {
  const { content } = message;
  switch (delta.type) {
    case "text_start":
      return { ...message, content: setBlock(content, delta.contentIndex, { type: "text", text: "" }) };
    case "thinking_start":
      return { ...message, content: setBlock(content, delta.contentIndex, { type: "thinking", thinking: "" }) };
    case "text_delta": {
      const block = content[delta.contentIndex];
      const text = block?.type === "text" ? block : { type: "text" as const, text: "" };
      return { ...message, content: setBlock(content, delta.contentIndex, { ...text, text: text.text + delta.delta }) };
    }
    case "thinking_delta": {
      const block = content[delta.contentIndex];
      const thinking = block?.type === "thinking" ? block : { type: "thinking" as const, thinking: "" };
      return {
        ...message,
        content: setBlock(content, delta.contentIndex, { ...thinking, thinking: thinking.thinking + delta.delta }),
      };
    }
    case "text_end": {
      const block = content[delta.contentIndex];
      const text = block?.type === "text" ? block : { type: "text" as const, text: "" };
      return { ...message, content: setBlock(content, delta.contentIndex, { ...text, text: delta.content }) };
    }
    case "thinking_end": {
      const block = content[delta.contentIndex];
      const thinking = block?.type === "thinking" ? block : { type: "thinking" as const, thinking: "" };
      return { ...message, content: setBlock(content, delta.contentIndex, { ...thinking, thinking: delta.content }) };
    }
    case "image_end":
      return { ...message, content: setBlock(content, delta.contentIndex, delta.content) };
    case "toolcall_start":
      return {
        ...message,
        content: setBlock(content, delta.contentIndex, { type: "toolCall", id: "", name: "", arguments: {} }),
      };
    case "toolcall_end":
      return { ...message, content: setBlock(content, delta.contentIndex, delta.toolCall) };
    case "start":
    case "done":
    case "error":
      return message;
  }
}

export function applyTranscriptEvent(t: Transcript, event: TranscriptEvent): Transcript {
  switch (event.type) {
    case "history": {
      const items: TranscriptItem[] = event.messages.map((message, i) => ({
        kind: "message",
        key: `h:${i}`,
        message,
        streaming: false,
        at: "timestamp" in message && typeof message.timestamp === "number" ? message.timestamp : 0,
        endedAt: null,
      }));
      const indexByKey: Record<string, number> = {};
      items.forEach((item, i) => {
        if (item.kind === "message") indexByKey[item.key] = i;
      });
      return { items, indexByKey, tools: {}, runs: [] };
    }
    case "run_start":
      return {
        ...t,
        runs: [...t.runs, { startedAt: event.at, endedAt: null, yielded: false, toolCalls: 0, subagents: 0 }],
      };
    case "run_end":
      return withRun(t, (run) => (run.endedAt === null ? { ...run, endedAt: event.at, yielded: event.yielded } : run));
    case "message_start": {
      const isAssistant = event.message.role === "assistant";
      // omp 的 message_start 在 assistant 消息上带的是当时的（可能已是最终的）content；块由随后的 delta 重建，这里清空，避免重复追加。
      const message = event.message.role === "assistant" ? { ...event.message, content: [] } : event.message;
      return upsertMessage(t, {
        kind: "message",
        key: event.key,
        message,
        streaming: isAssistant,
        at: event.at,
        endedAt: null,
      });
    }
    case "message_delta": {
      const item = messageAt(t, event.key);
      if (!item || item.message.role !== "assistant") return t;
      const message = applyAssistantDelta(item.message, event.delta);
      const streaming = event.delta.type === "done" || event.delta.type === "error" ? false : item.streaming;
      return upsertMessage(t, { ...item, message, streaming });
    }
    case "message_end": {
      const item = messageAt(t, event.key);
      return upsertMessage(t, {
        kind: "message",
        key: event.key,
        message: event.message,
        streaming: false,
        at: item?.at ?? event.at,
        endedAt: event.at,
      });
    }
    case "tool_start": {
      const run: ToolRun = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        intent: event.intent ?? null,
        status: "running",
        partialResult: undefined,
        result: undefined,
        startedAt: event.at,
        endedAt: null,
      };
      const next = withRun(t, (span) => ({ ...span, toolCalls: span.toolCalls + 1 }));
      return { ...next, tools: { ...next.tools, [event.toolCallId]: run } };
    }
    case "tool_update": {
      const run = t.tools[event.toolCallId];
      if (!run) return t;
      return { ...t, tools: { ...t.tools, [event.toolCallId]: { ...run, partialResult: event.partialResult } } };
    }
    case "tool_end": {
      const run = t.tools[event.toolCallId];
      if (!run) return t;
      const done: ToolRun = {
        ...run,
        status: event.isError ? "error" : "done",
        result: event.result,
        endedAt: event.at,
      };
      return { ...t, tools: { ...t.tools, [event.toolCallId]: done } };
    }
    case "subagent":
      return event.status === "started" ? withRun(t, (run) => ({ ...run, subagents: run.subagents + 1 })) : t;
    case "prompt_result":
      return event.status === "error"
        ? appendItem(t, { kind: "prompt_error", promptId: event.promptId, error: event.error ?? null, at: event.at })
        : t;
    case "settled":
      return t;
    case "notice":
      return appendItem(t, { kind: "notice", level: event.level, message: event.message, at: event.at });
    case "command_output":
      return appendItem(t, { kind: "command_output", text: event.text, at: event.at });
    case "status_line":
      return appendItem(t, { kind: "status_line", statusKind: event.kind, phase: event.phase, at: event.at });
  }
}
