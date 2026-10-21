// omp 恢复会话（`--resume`）时不重发、但会话里确有其事的两样东西，从 omp 的存档补出来（只读，不写 ~/.omp）：
//   · 每轮回答下方的用量脚注（omp.turn.usage）：omp 18.12.4 的 TSP 恢复路径只重发 omp.user / 工具卡片 / omp.assistant，
//     不带用量行。数据全在会话文件里（assistant 消息的 usage、completedAt，用户消息的 timestamp）。
//   · 空闲回顾（omp.recap）：omp 只在空闲时生成一次，写进 agent 目录 `history.db` 的 `session_recaps` 表
//     （`SessionManager.recordRecap`），不写会话文件，恢复时也不重放。
// 统计口径照抄 omp 的 TurnUsageAggregator（packages/tui 的 chat-transcript-builder）：非 agent 的用户消息开一轮并清零累计，
// assistant 消息累计 input+cacheWrite（+orchestration.input）、output（+orchestration.output）、cost.total，
// 遇到 stopReason 不是 toolUse 的消息结算；耗时 = 该消息 completedAt − 开这一轮的用户消息 timestamp（≤0 当没有）。
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TspSessionExtras, TspTurnFooter } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { resolveAgentDir } from "../history/session-index.ts";

/** omp 显示回顾时的最长字数（`ms.RECAP`）。 */
const RECAP_MAX_CHARS = 280;
/** history.db 的 created_at 是秒（向下取整）：和毫秒时间戳比较时留 1 秒误差。 */
const RECAP_CLOCK_SLACK_MS = 1000;

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

interface ParsedSession {
  /** 会话 id（session 头里的 id；history.db 用它当 session_id）。 */
  id: string | null;
  /** 最后一条 message 的时间戳（毫秒）；没有为 0。 */
  lastMessageAt: number;
  turns: (TspTurnFooter | null)[];
}

/** 从会话文件内容解析；坏行（含写到一半的最后一行）跳过。 */
export function parseSession(text: string): ParsedSession {
  const result: ParsedSession = { id: null, lastMessageAt: 0, turns: [] };
  let userAt: number | null = null;
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (entry["type"] === "session" && typeof entry["id"] === "string") result.id = entry["id"];
    if (entry["type"] !== "message" || !isRecord(entry["message"])) continue;
    const message = entry["message"];
    const timestamp = finite(message["timestamp"]);
    if (timestamp > result.lastMessageAt) result.lastMessageAt = timestamp;
    if (message["role"] === "user" && message["attribution"] !== "agent") {
      result.turns.push(null);
      userAt = timestamp > 0 ? timestamp : null;
      input = output = cost = 0;
      continue;
    }
    if (message["role"] !== "assistant") continue;
    const usage = isRecord(message["usage"]) ? message["usage"] : {};
    const orchestration = isRecord(usage["orchestration"]) ? usage["orchestration"] : {};
    const usageCost = isRecord(usage["cost"]) ? finite(usage["cost"]["total"]) : 0;
    input += finite(usage["input"]) + finite(usage["cacheWrite"]) + finite(orchestration["input"]);
    output += finite(usage["output"]) + finite(orchestration["output"]);
    cost += usageCost;
    if (message["stopReason"] === "toolUse") continue;
    if (result.turns.length > 0 && (input + output > 0 || cost > 0)) {
      const completedAt = finite(message["completedAt"]);
      const elapsed = userAt !== null && completedAt > 0 ? Math.round(completedAt - userAt) : 0;
      result.turns[result.turns.length - 1] = { elapsedMs: elapsed > 0 ? elapsed : null, input, output, cost };
    }
    input = output = cost = 0;
  }
  return result;
}

/** omp 显示回顾的文字：空白折叠成一个空格、去首尾，超过 280 字截断加 `…`（`tp(text, ms.RECAP)`）。 */
export function recapDisplayText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length <= RECAP_MAX_CHARS ? text : `${text.slice(0, RECAP_MAX_CHARS - 1)}…`;
}

/**
 * 这个会话最近一条回顾的显示文字。库不存在、没有 `session_recaps` 表、没有这个会话的回顾时为 null。
 * 回顾之后会话又有了新消息（`lastMessageAt` 比它晚）就不算：omp 的回顾是"离开期间"的小结，新一轮开始后它就过时了。
 */
export function readLatestRecap(historyDb: string, sessionId: string, lastMessageAt: number): string | null {
  if (!existsSync(historyDb)) return null;
  // history.db 是 WAL；omp 同时在写时读方短暂等待，不直接 BUSY。
  const db = new DatabaseSync(historyDb, { readOnly: true, timeout: 2000 });
  try {
    const hasTable = db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'session_recaps'")
      .get();
    if (hasTable === undefined) return null;
    const row = db
      .prepare(
        "SELECT recap, created_at FROM session_recaps WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(sessionId);
    if (!isRecord(row) || typeof row["recap"] !== "string" || typeof row["created_at"] !== "number") return null;
    if (row["created_at"] * 1000 + RECAP_CLOCK_SLACK_MS < lastMessageAt) return null;
    const text = recapDisplayText(row["recap"]);
    return text === "" ? null : text;
  } finally {
    db.close();
  }
}

/** 读会话文件和 history.db 补用量脚注和回顾；没有文件（新会话第一条回复之后才落盘）、读失败时为空。 */
export async function readSessionExtras(
  file: string | null,
  agentDir: string = resolveAgentDir(),
): Promise<TspSessionExtras> {
  const empty: TspSessionExtras = { turns: [], recap: null };
  if (file === null) return empty;
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return empty;
  const session = parseSession(text);
  let recap: string | null = null;
  if (session.id !== null) {
    try {
      recap = readLatestRecap(path.join(agentDir, "history.db"), session.id, session.lastMessageAt);
    } catch {
      // history.db 打不开（被锁、损坏）：只是少一条回顾，不影响用量脚注。
    }
  }
  return { turns: session.turns, recap };
}
