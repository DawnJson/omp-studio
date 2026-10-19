// omp 的会话事件帧 → TranscriptEvent。纯函数，语义与 test/transcript.test.ts 里的假主进程一致：
// 去掉 message_update 里的 partial（delta 模式下本来就没有），丢掉 toolcall_delta。
import type { RpcServerFrame } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { stripAnsi } from "../../shared/ansi.ts";
import type { AssistantDelta, TranscriptEvent } from "../../shared/transcript.ts";

/** `${gen}:${messageId}`：messageId 只在单个进程内唯一，进程重启会从头编号，所以带上 spawn 代号。 */
export function messageKey(gen: number, messageId: string | undefined): string {
  return `${gen}:${messageId ?? "?"}`;
}

export function translateFrame(frame: RpcServerFrame, gen: number, at: number): TranscriptEvent[] {
  switch (frame.type) {
    case "agent_start":
      return [{ type: "run_start", at }];
    case "agent_end":
      return [{ type: "run_end", at, yielded: frame.yielded ?? false }];
    case "message_start":
      return [{ type: "message_start", key: messageKey(gen, frame.messageId), message: frame.message, at }];
    case "message_update": {
      const event = frame.assistantMessageEvent;
      if (event.type === "toolcall_delta") return [];
      let delta: AssistantDelta;
      if (event.type === "done" || event.type === "error") delta = event;
      else {
        const { partial: _partial, ...rest } = event;
        delta = rest;
      }
      return [{ type: "message_delta", key: messageKey(gen, frame.messageId), delta }];
    }
    case "message_end":
      return [{ type: "message_end", key: messageKey(gen, frame.messageId), message: frame.message, at }];
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
      return [
        { type: "tool_end", toolCallId: frame.toolCallId, result: frame.result, isError: frame.isError ?? false, at },
      ];
    case "subagent_lifecycle":
      return [{ type: "subagent", id: frame.payload.id, status: frame.payload.status, at }];
    case "prompt_result":
      return [
        {
          type: "prompt_result",
          promptId: frame.id ?? "",
          status: frame.status,
          at,
          ...(frame.error && { error: frame.error }),
        },
      ];
    case "session_settled":
      return [{ type: "settled", at }];
    case "notice":
      return [{ type: "notice", level: frame.level, message: frame.message, at }];
    case "extension_error":
      return [{ type: "notice", level: "error", message: `${frame.event}: ${frame.error}`, at }];
    case "rpc_frame_error":
      return [{ type: "notice", level: "warning", message: frame.error, at }];
    case "command_output":
      return [{ type: "command_output", text: stripAnsi(frame.text), at }];
    case "auto_compaction_start":
      return [{ type: "status_line", kind: "compaction", phase: "start", at }];
    case "auto_compaction_end":
      return [{ type: "status_line", kind: "compaction", phase: "end", at }];
    case "auto_retry_start":
      return [{ type: "status_line", kind: "retry", phase: "start", at }];
    case "auto_retry_end":
      return [{ type: "status_line", kind: "retry", phase: "end", at }];
    default:
      return [];
  }
}
