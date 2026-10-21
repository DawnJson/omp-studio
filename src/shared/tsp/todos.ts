// 从 TSP 文档读 omp 的待办：dock 里的 HUD 节点（role `omp.hud.todo`，k `checklist`，`p.mode:"hud"`），
// 换算成 rpc 的 TodoPhase[]（TaskState.todoPhases / 待办板用）。纯函数，主进程每次文档变化时调用。
//
// 依据是 omp 18.12.3 的实测录制（fixtures/tsp/task.jsonl，test/tsp-todos.test.ts 逐帧验证）：
// - HUD 节点在 `omp.hud.activity` 行里，todo 工具第一次写入时出现（帧 27），之后每次工具调用整体更新 `p.phases`；
//   全部做完后还留着，回合结束时（录制最后一帧 145）随 omp 的自动清理消失，这时返回 []。
// - 阶段标题带罗马数字前缀（"I. Inspect"）；todo 工具卡片里的 checklist（mode full）没有前缀。待办板自己画序号，所以去掉。
// - 状态：pending / active / done / dropped / blocked（规范 §7.5）↔ pending / in_progress / completed / abandoned / blocked。
// - 只认 HUD，不回退到工具卡片：omp 清理待办后 HUD 消失，卡片还留在对话里，回退会让已清理的待办复活。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import type { TodoItem, TodoPhase, TodoStatus } from "../omp-wire/rpc-wire.generated.ts";
import { nodeRole, type TspDocument } from "./document.ts";
import type { TspText } from "./tsp.generated.ts";

export const TODO_HUD_ROLE = "omp.hud.todo";

const STATUS: Readonly<Record<string, TodoStatus>> = {
  pending: "pending",
  active: "in_progress",
  done: "completed",
  dropped: "abandoned",
  blocked: "blocked",
};

type Rec = Readonly<Record<string, unknown>>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plain(text: unknown): string {
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return (text as TspText & readonly unknown[])
    .map((span) => (isRec(span) && typeof span["t"] === "string" ? span["t"] : ""))
    .join("");
}

/** "I. Inspect" → "Inspect"；只去掉罗马数字加点加空格的前缀。 */
export function stripPhaseNumeral(title: string): string {
  return title.replace(/^[IVXLCDM]+\.\s+/, "");
}

/** 一个 checklist 节点的 `p.phases` → TodoPhase[]；认不出的阶段 / 条目跳过。 */
export function phasesOfChecklist(phases: unknown): TodoPhase[] {
  if (!Array.isArray(phases)) return [];
  const out: TodoPhase[] = [];
  for (const raw of phases as unknown[]) {
    if (!isRec(raw) || !Array.isArray(raw["items"])) continue;
    const tasks: TodoItem[] = [];
    for (const item of raw["items"] as unknown[]) {
      if (!isRec(item)) continue;
      const status = typeof item["status"] === "string" ? STATUS[item["status"]] : undefined;
      if (status === undefined) continue;
      const blocker = plain(item["note"]);
      tasks.push({
        content: plain(item["text"]),
        status,
        ...(status === "blocked" && blocker !== "" ? { blocker } : {}),
      });
    }
    out.push({ name: stripPhaseNumeral(plain(raw["title"])), tasks });
  }
  return out;
}

/** 文档里的待办；没有 HUD 节点（还没写过待办、或已被清理）返回 []。 */
export function deriveTodoPhases(document: TspDocument): TodoPhase[] {
  let found: unknown = null;
  for (const id of document.live) {
    const surface = document.surfaces.get(id);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k === "checklist" && nodeRole(node) === TODO_HUD_ROLE) found = node.p["phases"];
    }
  }
  return phasesOfChecklist(found);
}
