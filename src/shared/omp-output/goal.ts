// omp 会话文件里的目标记录（只读）：每次目标变化（创建、用量每 1–2 秒、暂停、恢复、预算、完成）omp 追加一条
// `{"type":"mode_change","mode":"goal"|"goal_paused","data":{"goal":{…}}}`；放弃目标和完成之后一秒追加 `{"mode":"none"}`。
// 实测（omp 18.12.5，fixtures/tsp/goal-*.jsonl 同一批场景的会话文件）：
//   创建 → {mode:"goal", data:{goal:{id, objective, status:"active", tokensUsed:0, timeUsedSeconds:0, createdAt, updatedAt}}}
//   设预算后多一个 tokenBudget；暂停 → mode:"goal_paused"、status:"paused"；超预算 → status:"budget-limited"（mode 仍是 "goal"）
//   agent 完成 → status:"complete"，随后 {mode:"none"}；`/goal drop` → 直接 {mode:"none"}（没有 dropped 记录）
// TSP 的输入框卡片只有"Goal 1.2K"这样的用量标签，目标文字只能从这里读（shared/tsp/goal.ts 合并两者）。文件格式不是 omp 的契约：
// 读不出来返回 null，界面少显示目标文字，不报错。纯函数。
import { finiteOrZero as finite, isRecord } from "../type-guards.ts";

export interface GoalRecord {
  id: string;
  objective: string;
  status: "active" | "paused" | "budget-limited" | "complete" | "dropped";
  tokensUsed: number;
  /** 没设预算为 null。 */
  tokenBudget: number | null;
  timeUsedSeconds: number;
}

export interface GoalSessionState {
  /** 最后一条目标记录；会话里从没有过目标为 null。 */
  record: GoalRecord | null;
  /** 最后一条 mode_change 是 `none`（目标已结束：完成或放弃）。 */
  cleared: boolean;
}

const STATUSES: ReadonlySet<string> = new Set(["active", "paused", "budget-limited", "complete", "dropped"]);

function toRecord(value: unknown): GoalRecord | null {
  if (!isRecord(value)) return null;
  const { id, objective, status } = value;
  if (typeof id !== "string" || typeof objective !== "string" || typeof status !== "string" || !STATUSES.has(status))
    return null;
  const budget = value["tokenBudget"];
  return {
    id,
    objective,
    status: status as GoalRecord["status"],
    tokensUsed: finite(value["tokensUsed"]),
    tokenBudget: typeof budget === "number" && Number.isFinite(budget) ? budget : null,
    timeUsedSeconds: finite(value["timeUsedSeconds"]),
  };
}

/** 从会话文件内容（可以只是尾部）读目标状态；坏行（含截断的第一行和写到一半的最后一行）跳过。 */
export function parseGoalSession(text: string): GoalSessionState {
  const state: GoalSessionState = { record: null, cleared: false };
  for (const line of text.split("\n")) {
    if (!line.includes('"mode_change"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry["type"] !== "mode_change") continue;
    const mode = entry["mode"];
    if (mode === "none") {
      state.cleared = true;
      continue;
    }
    if (mode !== "goal" && mode !== "goal_paused") continue;
    const data = entry["data"];
    const record = isRecord(data) ? toRecord(data["goal"]) : null;
    if (record === null) continue;
    state.record = record;
    state.cleared = false;
  }
  return state;
}
