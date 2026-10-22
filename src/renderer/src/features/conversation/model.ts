// 子代理记录（agents 面板的历史消息）整理成"轮"：每轮 = 过程步骤 + 结论。纯函数，不碰 DOM。
// 叙述/结论启发式（spec 4.9 / 裁决 Calm-2）：以工具调用结尾的消息里的文字是叙述，进过程；
// 最后一条不带工具调用的消息是结论；整轮没有这样的消息时，把最后一条有文字的助手消息当结论（子代理还在跑的最后一轮除外）。
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
} from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { resultText } from "./tool-info.ts";

export interface ToolStep {
  kind: "tool";
  key: string;
  name: string;
  intent: string | null;
  args: unknown;
  /** running：子代理还在跑、这次调用的结果还没写进记录。 */
  status: "done" | "error" | "running";
  /** 输出文字。 */
  output: string | null;
  result: unknown;
}

export type Step =
  ToolStep | { kind: "narration"; key: string; text: string } | { kind: "thinking"; key: string; text: string };

export interface Turn {
  key: string;
  steps: Step[];
  answer: string | null;
}

interface Entry {
  key: string;
  message: AgentMessage;
}

function toolFromResultMessage(
  call: { id: string; name: string; arguments: unknown; intent?: string | undefined },
  result: ToolResultMessage | undefined,
  live: boolean,
): ToolStep {
  return {
    kind: "tool",
    key: `tool:${call.id}`,
    name: call.name,
    intent: call.intent ?? null,
    args: call.arguments,
    // 没有结果：子代理还在跑就是正在执行；已经结束（被中断）按完成处理。
    status: result ? (result.isError ? "error" : "done") : live ? "running" : "done",
    output: result ? resultText({ content: result.content }) : null,
    result: result ? { content: result.content, details: result.details } : undefined,
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

function buildTurn(group: readonly Entry[], index: number, live: boolean): Turn {
  const first = group[0] as Entry;
  const resultsById = new Map<string, ToolResultMessage>();
  const assistants: { key: string; message: AssistantMessage }[] = [];
  for (const { key, message } of group) {
    if (message.role === "toolResult") resultsById.set(message.toolCallId, message);
    else if (message.role === "assistant") assistants.push({ key, message });
  }

  const withText = assistants.filter((item) => textOf(item.message) !== "");
  // 还在跑的那一轮没有结论：叙述留在过程里，不拿最后一句叙述充当结论。
  const conclusion =
    withText.filter((item) => !item.message.content.some((block) => block.type === "toolCall")).at(-1) ??
    (live ? null : withText.at(-1)) ??
    null;

  const steps: Step[] = [];
  const seenTools = new Set<string>();
  for (const item of assistants) {
    const isConclusion = item === conclusion;
    item.message.content.forEach((block, blockIndex) => {
      const key = `${item.key}#${blockIndex}`;
      if (block.type === "thinking" && !block.narration && block.thinking.trim() !== "")
        steps.push({ kind: "thinking", key, text: block.thinking });
      else if ((block.type === "text" || (block.type === "thinking" && block.narration)) && !isConclusion) {
        const text = block.type === "text" ? block.text : block.thinking;
        if (text.trim() !== "") steps.push({ kind: "narration", key, text: text.trim() });
      } else if (block.type === "toolCall" && !seenTools.has(block.id)) {
        seenTools.add(block.id);
        steps.push(toolFromResultMessage(block, resultsById.get(block.id), live));
      }
    });
  }

  return {
    key: first.message.role === "user" ? first.key : `turn:${index}`,
    steps,
    answer: conclusion ? textOf(conclusion.message) : null,
  };
}

/** 历史消息 → 轮：一条非合成的用户消息或用户的 `!命令` 开一轮。live：子代理还在跑，最后一轮里没结果的调用算正在执行。 */
export function buildTurns(messages: readonly AgentMessage[], live: boolean): Turn[] {
  const groups: Entry[][] = [];
  messages.forEach((message, index) => {
    const entry = { key: `h:${index}`, message };
    const startsTurn = (message.role === "user" && message.synthetic !== true) || message.role === "bashExecution";
    if (startsTurn || groups.length === 0) groups.push([entry]);
    else (groups[groups.length - 1] as Entry[]).push(entry);
  });
  return groups.map((group, index) => buildTurn(group, index, live && index === groups.length - 1));
}
