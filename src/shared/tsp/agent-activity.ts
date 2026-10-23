// 子代理面板的 Activity 页（omp Agent Hub 的 "2 Activity"：所有子代理按时间排的活动流，可按 All / Errors / Responses / Tools 过滤）。
// 数据是面板本来就在读的子代理记录（`<名字>.jsonl`，每行 `{type:"message", message}`，见 main/tsp/subagent-file.ts）：
//   · 助手消息里的 `toolCall` 块 = 一次工具调用（时间取消息的 completedAt / timestamp，文字取 intent 或第一个有意义的参数）；
//   · 助手消息里的 `text` 块 = 一次回复；`stopReason: "error"` 的助手消息 = 一次出错（文字是 errorMessage）；
//   · `toolResult` 且 `isError` = 一次出错（文字是结果的第一段文字），并把对应那次工具调用标成失败。
// 纯函数，不碰 IO；主进程不用，放 shared 是为了单测直接 import。
import type { AgentMessage } from "../omp-wire/rpc-wire.generated.ts";
import { isRecord } from "../type-guards.ts";

export type ActivityKind = "tool" | "response" | "error";
export type ActivityFilter = "all" | "errors" | "responses" | "tools";
export const ACTIVITY_FILTERS: readonly ActivityFilter[] = ["all", "errors", "responses", "tools"];

export interface ActivityItem {
  /** 稳定 id：`<名字>:<消息序号>:<块序号>`，列表 key 用。 */
  id: string;
  agent: string;
  /** 毫秒时间戳；记录里没有时间的消息为 0（排在最后）。 */
  at: number;
  kind: ActivityKind;
  /** 工具名（`tool` 和有工具名的 `error`）；其余为 null。 */
  tool: string | null;
  /** 一行文字：工具的意图 / 目标，回复的第一段，错误信息。 */
  text: string;
  /** 工具调用对应的结果是错误。 */
  failed: boolean;
}

/** 面板里最多留多少条活动（最新的优先）。 */
export const ACTIVITY_MAX_ITEMS = 500;
const TEXT_MAX_CHARS = 200;
/** 工具参数里最像"目标"的字段，按顺序取第一个字符串。 */
const TARGET_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "task", "description", "id"] as const;

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TEXT_MAX_CHARS ? `${line.slice(0, TEXT_MAX_CHARS)}…` : line;
};

function toolText(block: Record<string, unknown>): string {
  if (typeof block["intent"] === "string" && block["intent"].trim() !== "") return clip(block["intent"]);
  const args = isRecord(block["arguments"]) ? block["arguments"] : {};
  for (const key of TARGET_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return clip(value);
  }
  return "";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block: unknown) =>
      isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
    )
    .join("\n");
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 一个子代理的记录 → 活动条目（按记录里的先后，未排序）。 */
export function activityFromMessages(agent: string, messages: readonly AgentMessage[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  const calls = new Map<string, ActivityItem>();
  for (const [index, raw] of messages.entries()) {
    const message: unknown = raw;
    if (!isRecord(message)) continue;
    const at = finite(message["completedAt"]) ?? finite(message["timestamp"]) ?? 0;
    if (message["role"] === "assistant") {
      const content = Array.isArray(message["content"]) ? (message["content"] as readonly unknown[]) : [];
      for (const [blockIndex, block] of content.entries()) {
        if (!isRecord(block)) continue;
        const id = `${agent}:${index}:${blockIndex}`;
        if (block["type"] === "toolCall" && typeof block["name"] === "string") {
          const item: ActivityItem = {
            id,
            agent,
            at,
            kind: "tool",
            tool: block["name"],
            text: toolText(block),
            failed: false,
          };
          items.push(item);
          if (typeof block["id"] === "string") calls.set(block["id"], item);
        } else if (block["type"] === "text" && typeof block["text"] === "string" && block["text"].trim() !== "") {
          items.push({ id, agent, at, kind: "response", tool: null, text: clip(block["text"]), failed: false });
        }
      }
      if (message["stopReason"] === "error") {
        const reason = typeof message["errorMessage"] === "string" ? message["errorMessage"] : "";
        items.push({
          id: `${agent}:${index}:error`,
          agent,
          at,
          kind: "error",
          tool: null,
          text: clip(reason),
          failed: true,
        });
      }
    } else if (message["role"] === "toolResult" && message["isError"] === true) {
      const callId = message["toolCallId"];
      const call = typeof callId === "string" ? calls.get(callId) : undefined;
      if (call) call.failed = true;
      items.push({
        id: `${agent}:${index}:result`,
        agent,
        at,
        kind: "error",
        tool: typeof message["toolName"] === "string" ? message["toolName"] : (call?.tool ?? null),
        text: clip(contentText(message["content"])),
        failed: true,
      });
    }
  }
  return items;
}

/** 所有子代理的记录 → 一条按时间从新到旧排的活动流（时间相同保持"后写的在前"），最多 `ACTIVITY_MAX_ITEMS` 条。 */
export function mergeActivity(
  records: readonly { name: string; messages: readonly AgentMessage[] | null }[],
): ActivityItem[] {
  const all = records.flatMap((record, order) =>
    activityFromMessages(record.name, record.messages ?? []).map((item, position) => ({ item, order, position })),
  );
  all.sort((a, b) => b.item.at - a.item.at || b.order - a.order || b.position - a.position);
  return all.slice(0, ACTIVITY_MAX_ITEMS).map(({ item }) => item);
}

/** omp 的四个过滤：All / Errors（出错）/ Responses（回复）/ Tools（工具调用，含失败的）。 */
export function filterActivity(items: readonly ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  switch (filter) {
    case "all":
      return [...items];
    case "errors":
      return items.filter((item) => item.kind === "error");
    case "responses":
      return items.filter((item) => item.kind === "response");
    case "tools":
      return items.filter((item) => item.kind === "tool");
  }
}
