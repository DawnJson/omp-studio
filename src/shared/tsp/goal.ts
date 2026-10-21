// TSP 任务的目标模式（omp `/goal`）：从文档读状态，拼出 `TaskState.goal`；以及 `/goal drop` 要点的确认选择器。纯函数。
//
// 实测（omp 18.12.5，fixtures/tsp/goal-{pause-resume,drop,budget}.jsonl，test/tsp-goal.test.ts 逐帧验证）：
// - 目标状态在 omp 输入框卡片（role `omp.editor`）的"状态事实"行里：role `omp.composer.fact` 的 `seg`（id 随版本变，现在是
//   `j.bar/extras/mode`），文字 `Goal <已用>` 或有预算时 `Goal <已用>/<预算>`（"Goal 0"、"Goal 1.2K"、"Goal 2.1K/1.5K"，
//   数字是 omp 缩写的 K/M/B），图标 `goal` = 进行中、`pause`（tone warning）= 已暂停、`warning` = 预算用尽。没有目标时没有这个节点。
// - 目标文字不在文档里（只在 `/goal` 选择器的标题里被截成 40 字、和一条 toast 里）：从会话文件读（omp-output/goal.ts）。
// - 开着选择器 / 弹窗时 omp 把整个输入框卡片从文档里拿掉（`del j`），卡片回来时才重新出现：卡片不在 = 不知道，沿用上一次的值；
//   卡片在而没有事实行 = 没有目标（放弃、完成都是这样）。
// - `/goal pause` → toast "Goal mode paused."；`/goal resume` → "Goal mode resumed."；`/goal drop` 先开 picker "Drop goal?"
//   （items Yes / No，id 0 / 1），确认后 toast "Goal dropped."；已有目标时再 `/goal <文字>` → toast
//   "Goal mode is already active. Use /goal to manage it, or /goal drop to start over."（没有 toast 就是创建成功：事实行出现）。
// role / 文字是 omp 自己的命名，不在 TSP 规范里：omp 改名这些规则就失效，判断集中在这里。
import type { TaskGoal } from "../ipc.ts";
import type { GoalRecord } from "../omp-output/goal.ts";
import { findNode, nodeRole, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

const COMPOSER_ROLE = "omp.editor";
const FACT_ROLE = "omp.composer.fact";
const GOAL_FACT = /^Goal\b\s*(.*)$/;

/** 输入框卡片上的目标事实。 */
export interface GoalFact {
  status: TaskGoal["status"];
  /** 标签里的已用量，原文（"1.2K"）；没有为空串。 */
  usedLabel: string;
  /** 标签里的预算，原文；没设预算为 null。 */
  budgetLabel: string | null;
}

export interface GoalDocumentState {
  /** 输入框卡片在文档里（不在 = 被选择器 / 弹窗 / 提问替换了，这时 `fact` 不可信）。 */
  composer: boolean;
  fact: GoalFact | null;
}

const MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

/** omp 的缩写数字："443" → 443，"1.2K" → 1200，"11K" → 11000，"1.5M" → 1500000；认不出为 null。 */
export function parseTokenLabel(label: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(label.trim());
  if (!match) return null;
  const value = Number.parseFloat(match[1]!) * (match[2] === undefined ? 1 : MULTIPLIER[match[2].toUpperCase()]!);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function plainText(node: DocNode): string {
  const { text, spans } = node.p;
  if (typeof text === "string") return text;
  if (!Array.isArray(spans)) return "";
  let joined = "";
  for (const span of spans as readonly unknown[]) {
    if (span !== null && typeof span === "object" && "t" in span && typeof span.t === "string") joined += span.t;
  }
  return joined;
}

/** 一个"状态事实"节点 → 目标事实；不是目标的事实（计划模式等）为 null。 */
export function parseGoalFact(node: DocNode): GoalFact | null {
  if (node.k !== "seg" || nodeRole(node) !== FACT_ROLE) return null;
  const match = GOAL_FACT.exec(plainText(node).trim());
  if (!match) return null;
  const [usedLabel = "", budgetLabel] = match[1]!.split("/").map((part) => part.trim());
  const icon = node.p["icon"];
  const status = icon === "pause" ? "paused" : icon === "warning" ? "budget-limited" : "active";
  return { status, usedLabel, budgetLabel: budgetLabel === undefined || budgetLabel === "" ? null : budgetLabel };
}

function findComposerCard(doc: TspDocument): { surface: DocSurface; card: DocNode } | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const card = findNode(surface, (node) => nodeRole(node) === COMPOSER_ROLE, "dock");
    if (card) return { surface, card };
  }
  return null;
}

export function deriveGoalFact(doc: TspDocument): GoalDocumentState {
  const found = findComposerCard(doc);
  if (!found) return { composer: false, fact: null };
  const node = findNode(found.surface, (candidate) => parseGoalFact(candidate) !== null, found.card.id);
  return { composer: true, fact: node === null ? null : parseGoalFact(node) };
}

export function sameGoalFact(a: GoalFact | null, b: GoalFact | null): boolean {
  if (a === null || b === null) return a === b;
  return a.status === b.status && a.usedLabel === b.usedLabel && a.budgetLabel === b.budgetLabel;
}

/**
 * 事实行 + 会话文件里的记录 → `TaskState.goal`。状态、用量、预算以事实行为准（实时）；目标文字、id、时长来自记录
 * （记录是目标还挂着的状态才用，上一个已完成的目标的记录不能串进来）；记录读不到时目标文字用 `fallbackObjective`
 * （studio 自己创建时发出去的那段字），再没有就是空串。
 */
export function taskGoalFromFact(fact: GoalFact, record: GoalRecord | null, fallbackObjective: string): TaskGoal {
  const live = record !== null && record.status !== "complete" && record.status !== "dropped" ? record : null;
  const used = parseTokenLabel(fact.usedLabel);
  const budget = fact.budgetLabel === null ? null : parseTokenLabel(fact.budgetLabel);
  return {
    id: live?.id ?? "tsp",
    objective: live?.objective ?? fallbackObjective,
    status: fact.status,
    tokensUsed: used ?? live?.tokensUsed ?? 0,
    tokenBudget: fact.budgetLabel === null ? null : (budget ?? live?.tokenBudget ?? null),
    timeUsedSeconds: live?.timeUsedSeconds ?? 0,
  };
}

// ───────── 操作 ─────────

/** `/goal pause|resume|drop` 成功时 omp 的 toast。 */
export const GOAL_TOASTS = {
  pause: /^Goal mode paused\b/i,
  resume: /^Goal mode resumed\b/i,
  drop: /^Goal dropped\b/i,
} as const;

/** `/goal drop` 打开的确认选择器（"Drop goal?"，Yes / No）；没开着为 null。`yes` 是 "Yes" 那一项的 id。 */
export interface GoalDropPrompt {
  sf: string;
  id: string;
  yes: string;
}

export function findGoalDropPrompt(doc: TspDocument): GoalDropPrompt | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const picker = findNode(
      surface,
      (node) => node.k === "picker" && typeof node.p["title"] === "string" && /^Drop goal\b/i.test(node.p["title"]),
      "layer",
    );
    if (!picker || !Array.isArray(picker.p["items"])) continue;
    for (const item of picker.p["items"] as readonly unknown[]) {
      if (item === null || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") continue;
      if ("label" in item && typeof item.label === "string" && /^yes$/i.test(item.label))
        return { sf, id: picker.id, yes: item.id };
    }
  }
  return null;
}
