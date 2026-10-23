// omp 输入框卡片和状态区里 studio 没有直接对应控件的"事实"：模式（Plan / Prewalk / Goal / Vibe / Loop）、扩展写的状态、
// 上一轮被中断的重试提示、自动重试倒计时、压缩进度、聚焦的子代理、实时生成速度。纯函数：从文档一次推出全部，
// 主进程（模式、扩展状态、目标：要跨"输入框卡片被弹窗换掉"记住，TaskState.composerMode / extStatuses / goal）和渲染进程
// （其余的，直接跟着文档走）各取所需。
//
// 依据 omp 18.12.6（2026-10-23）源码和真实录制（fixtures/tsp/{goal-*,composer-modes,composer-loop,composer-retry,composer-interrupted,
// compact-ok,hub-steer,session-tree-summarize}.jsonl，test/tsp-composer-facts.test.ts 逐帧验证）：
// - 输入框卡片（role `omp.editor`）里的 `status`（role `omp.composer.extras`）下，每个状态行片段是一个 `seg`（role
//   `omp.composer.fact`），id 的最后一段是片段名（packages/tui/src/status-line/component.ts `describeComposerFacts`）：
//   · `mode`：同一时刻只显示一种模式，优先级 Plan > Prewalk > Goal > Vibe > Loop（segments.ts `mode.describe`）。文字：
//     `Plan` / `Plan (paused)`（tone warning）、`Prewalk`、`Goal <已用>[/<预算>]`、`Vibe`、
//     `Loop[:] <running|paused|next prompt repeats> [<剩余>/<总数> | <时长> left] [until|while: <命令前 33 字>]`（`/loop` 的命令被 omp 截断）。
//   · `hook-<N>`：扩展 `ctx.ui.setStatus(key, text)` 写的状态（key 不在文档里，只有文字）。
//   git、PR、路径之类别的片段（18.12.5 的 git 事实 `git`）不是这里要的，按片段名区分，不按文字：分支叫 "Vibe" 也不会被当成模式。
// - 速度：`rate` 节点（role `omp.composer.rate`，`p.value` tok/s，一位小数）在卡片的 `bar` 行里，只有设置 `composer.tokenRate` 开着时才有。
// - 状态区（dock 里 `omp.hud.activity` → `omp.hud.status`）：
//   · 上一轮停在工具调用中途（`hasAbortedToolCallTail`）：`row role=omp.hint.retry`（图标 + 键帽 F5 + "to retry"）；
//   · 自动重试：`row role=omp.working`，第一个子节点是 `meter style=ring`（`p.value` 1 → 0，剩余等待时间的比例，每 0.5 秒一帧），
//     标签 `Retrying · attempt <N> of <M>`，`omp.working.stop`（标题 "Cancel  esc"，`actions.click` = `interrupt`）；
//   · 压缩（手动 / 自动）：同一个 `omp.working` 行，标签 "Compacting context…"，多一个没有 value 的 `progress`，`omp.working.stop` 标题 "Stop  esc"。
// - 聚焦子代理：卡片里的 `omp.composer.focus` 行，见 agent-hub.ts 的 `findFocus`。
// role / 片段名 / 文字是 omp 自己的命名，不在 TSP 规范里：omp 改名这些规则就失效，判断集中在这里。
import type { TaskMode } from "../ipc.ts";
import { stripIconGlyphs } from "../ui/clean-title.ts";
import { findFocus, type FocusView } from "./agent-hub.ts";
import { findComposerCard } from "./composer-state.ts";
import { nodeRole, plainText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

const FACT_ROLE = "omp.composer.fact";
const RATE_ROLE = "omp.composer.rate";
const RETRY_HINT_ROLE = "omp.hint.retry";
const WORKING_ROLE = "omp.working";
const WORKING_STOP_ROLE = "omp.working.stop";
const WORKING_LABEL_ROLE = "omp.working.label";
const MODE_SEGMENT = "mode";
const HOOK_SEGMENT = /^hook-\d+$/;

/** 输入框卡片上的目标事实（`Goal 1.2K` / `Goal 2.1K/1.5K`）。 */
export interface GoalFact {
  status: "active" | "paused" | "budget-limited";
  /** 标签里的已用量，原文（"1.2K"）；没有为空串。 */
  usedLabel: string;
  /** 标签里的预算，原文；没设预算为 null。 */
  budgetLabel: string | null;
}

/** 模式事实：目标之外的是 `TaskState.composerMode`，目标是 `TaskState.goal`（goal.ts 把事实行和会话文件合起来）。 */
export type ComposerMode = TaskMode | { kind: "goal"; fact: GoalFact };

/** 文档里能被"点"的节点：给 `action` 事件用。 */
export interface ActionTarget {
  sf: string;
  id: string;
  act: string;
}

export interface AutoRetryFact {
  attempt: number;
  max: number;
  /** 倒计时圆环的 `value`（1 → 0，剩余等待的比例）；圆环没有（终端不支持 meter）为 null。 */
  remaining: number | null;
  /** 取消按钮（`omp.working.stop`，点它 = Esc）；没有为 null。 */
  cancel: ActionTarget | null;
}

export interface CompactionFact {
  /** 工作行的标签（"Compacting context…"）。 */
  label: string;
  stop: ActionTarget | null;
}

export interface ComposerFacts {
  /** 输入框卡片在文档里（不在 = 被选择器 / 弹窗 / 提问换掉了：`mode` 和 `extStatuses` 这时不可信，沿用上一次的值）。 */
  composer: boolean;
  mode: ComposerMode | null;
  /** 扩展写的状态，按出现顺序（`hook-0`、`hook-1`…）。 */
  extStatuses: readonly string[];
  /** 上一轮停在工具调用中途，omp 提示"F5 重试"。 */
  interrupted: boolean;
  retry: AutoRetryFact | null;
  compaction: CompactionFact | null;
  focus: FocusView | null;
  /** 实时生成速度（tok/s，一位小数）；没有为 null。 */
  rate: number | null;
}

// ───────── 模式 ─────────

function parseGoalFact(text: string, icon: unknown): GoalFact | null {
  const match = /^Goal\b\s*(.*)$/.exec(text);
  if (!match) return null;
  const [usedLabel = "", budgetLabel] = match[1]!.split("/").map((part) => part.trim());
  const status = icon === "pause" ? "paused" : icon === "warning" ? "budget-limited" : "active";
  return { status, usedLabel, budgetLabel: budgetLabel === undefined || budgetLabel === "" ? null : budgetLabel };
}

type LoopMode = Extract<TaskMode, { kind: "loop" }>;

function parseLoopLimit(text: string): LoopMode["limit"] {
  const count = /^(\d+)\/(\d+)$/.exec(text);
  if (count) return { kind: "iterations", remaining: Number(count[1]), initial: Number(count[2]) };
  const duration = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)? left$/.exec(text);
  if (duration && (duration[1] ?? duration[2] ?? duration[3]) !== undefined)
    return {
      kind: "duration",
      secondsLeft: Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0),
    };
  return null;
}

function parseLoop(text: string): LoopMode | null {
  const match = /^Loop:? (running|paused|next prompt repeats)(?: (.*))?$/.exec(text);
  if (!match) return null;
  const state = match[1] === "next prompt repeats" ? "waiting" : (match[1] as "running" | "paused");
  const rest = match[2] ?? "";
  const condition = /(?:^|\s)(until|while): (.*)$/.exec(rest);
  const limitText = (condition ? rest.slice(0, condition.index) : rest).trim();
  return {
    kind: "loop",
    state,
    limit: limitText === "" ? null : parseLoopLimit(limitText),
    condition: condition ? { until: condition[1] === "until", command: condition[2]! } : null,
  };
}

/** `mode` 片段的文字和图标 → 模式；不是已知模式为 null。 */
export function parseModeText(text: string, icon: unknown): ComposerMode | null {
  const trimmed = text.trim();
  if (trimmed === "Plan") return { kind: "plan", paused: false };
  if (trimmed === "Plan (paused)") return { kind: "plan", paused: true };
  if (trimmed === "Prewalk") return { kind: "prewalk" };
  if (trimmed === "Vibe") return { kind: "vibe" };
  const goal = parseGoalFact(trimmed, icon);
  if (goal) return { kind: "goal", fact: goal };
  return parseLoop(trimmed);
}

// ───────── 读文档 ─────────

/** 片段节点 id（`j.bar/extras/mode`）的最后一段。 */
function segmentName(node: DocNode): string {
  return node.id.slice(node.id.lastIndexOf("/") + 1);
}

/** `from` 下（含自己）按文档顺序的所有节点。 */
function* descendants(surface: DocSurface, from: string): Generator<DocNode> {
  const stack = [from];
  while (stack.length > 0) {
    const node = surface.nodes.get(stack.pop()!);
    if (!node) continue;
    yield node;
    for (let index = node.c.length - 1; index >= 0; index -= 1) stack.push(node.c[index]!);
  }
}

function targetOf(sf: string, node: DocNode | null): ActionTarget | null {
  const actions = node?.p["actions"];
  if (node === null || typeof actions !== "object" || actions === null) return null;
  const act = (actions as Record<string, unknown>)["click"];
  return typeof act === "string" ? { sf, id: node.id, act } : null;
}

/** dock 里的 `omp.working` 行：自动重试和压缩都画在这一行里（普通运行也是它，没有 ring / progress 子节点）；顺带找"重试"提示。 */
function readStatusArea(doc: TspDocument): {
  retry: AutoRetryFact | null;
  compaction: CompactionFact | null;
  interrupted: boolean;
} {
  let interrupted = false;
  let retry: AutoRetryFact | null = null;
  let compaction: CompactionFact | null = null;
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    for (const node of descendants(surface, "dock")) {
      const role = nodeRole(node);
      if (role === RETRY_HINT_ROLE) interrupted = true;
      if (role !== WORKING_ROLE) continue;
      let label = "";
      let ring: number | null = null;
      let progress = false;
      let stop: DocNode | null = null;
      for (const child of descendants(surface, node.id)) {
        const childRole = nodeRole(child);
        if (childRole === WORKING_LABEL_ROLE) label = plainText(child).trim();
        else if (childRole === WORKING_STOP_ROLE) stop = child;
        else if (child.k === "meter" && child.p["style"] === "ring")
          ring = typeof child.p["value"] === "number" ? child.p["value"] : null;
        else if (child.k === "progress") progress = true;
      }
      const attempt = /^Retrying · attempt (\d+) of (\d+)$/.exec(label);
      if (attempt && retry === null)
        retry = { attempt: Number(attempt[1]), max: Number(attempt[2]), remaining: ring, cancel: targetOf(sf, stop) };
      else if (progress && compaction === null) compaction = { label, stop: targetOf(sf, stop) };
    }
  }
  return { retry, compaction, interrupted };
}

export function deriveComposerFacts(doc: TspDocument): ComposerFacts {
  const base = { ...readStatusArea(doc), focus: findFocus(doc) };
  const found = findComposerCard(doc);
  if (!found) return { ...base, composer: false, mode: null, extStatuses: [], rate: null };
  const { surface, card } = found;
  let mode: ComposerMode | null = null;
  let rate: number | null = null;
  const extStatuses: string[] = [];
  for (const node of descendants(surface, card.id)) {
    const role = nodeRole(node);
    if (role === RATE_ROLE) {
      const value = node.p["value"];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) rate = value;
      continue;
    }
    if (role !== FACT_ROLE || node.k !== "seg") continue;
    const segment = segmentName(node);
    if (segment === MODE_SEGMENT) mode = parseModeText(plainText(node), node.p["icon"]);
    else if (HOOK_SEGMENT.test(segment)) {
      const text = stripIconGlyphs(plainText(node));
      if (text !== "") extStatuses.push(text);
    }
  }
  return { ...base, composer: true, mode, extStatuses, rate };
}

export function sameComposerMode(a: ComposerMode | null, b: ComposerMode | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameComposerFacts(a: ComposerFacts, b: ComposerFacts): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ───────── 自动重试倒计时 ─────────

/** 一次重试等待里的一个观察：圆环的值和观察时间（ms）。 */
export interface RetrySample {
  at: number;
  remaining: number;
}

/**
 * 圆环只给比例（剩余 / 总等待），总等待（omp 的 `delayMs`）不在文档里：用第一帧（满环）和当前帧估算
 * 总等待 = 过去的时间 ÷ 已走的比例，再乘当前比例得剩余秒数。走过的比例不到 5% 时估不准，返回 null。
 */
export function estimateRetrySeconds(first: RetrySample, now: RetrySample): number | null {
  const elapsed = now.at - first.at;
  const spent = first.remaining - now.remaining;
  if (spent < 0.05 || elapsed <= 0) return null;
  return Math.max(0, Math.ceil(((elapsed / spent) * now.remaining) / 1000));
}

// ───────── 模式命令（/plan /plan-review /vibe /loop）─────────

/**
 * 模式命令都是"切换"：`/plan` 在计划模式里是退出（先到 `Plan (paused)`，再发一次才关闭，已有计划时 omp 先弹确认），`/loop` 在循环开着时是关闭。
 * 所以发之前要看当前模式，生效与否也看模式有没有变成预期的样子，不看 omp 说了什么（成功和被拒都有 toast："Plan mode enabled." / "Exit goal mode first."）。
 */
export type ModeOp = "plan" | "planReview" | "vibe" | "loopStart" | "loopStop";

/** 发之前就知道不该发的原因（英文，直接作错误显示）；可以发为 null。 */
export function modeCommandBlocker(op: ModeOp, before: ComposerMode | null): string | null {
  if (op === "loopStart" && before?.kind === "loop") return "loop mode is already on";
  if (op === "loopStop" && before?.kind !== "loop") return "loop mode is not on";
  return null;
}

/** 命令生效了：模式变成预期的样子，或 omp 为它弹出了确认 / 评审弹窗（那是在等用户，不算失败）。 */
export function modeCommandDone(
  op: ModeOp,
  before: ComposerMode | null,
  now: ComposerMode | null,
  modalOpen: boolean,
): boolean {
  if (op === "planReview") return modalOpen;
  if (op === "loopStart") return now?.kind === "loop";
  if (op === "loopStop") return now?.kind !== "loop";
  return modalOpen || !sameComposerMode(before, now);
}

// ───────── 空闲 loader ─────────

/**
 * dock 里 `omp.loader` 的文字（交接、建 worktree、分支摘要等"没有 agent 一轮但 omp 在忙"，TaskState.loaderText）。能取消的 loader
 * 末尾是 `(<取消键> to cancel)`，取消键是图标字形，已被 stripIconGlyphs 去掉（fixtures/tsp/session-tree-summarize.jsonl：
 * "Summarizing branch... (to cancel)"）：界面自己画"取消"按钮（发 Esc），文字里不再留这句提示。
 */
export function parseLoaderText(text: string): { text: string; cancellable: boolean } {
  const cancel = /\s*\((?:[\w+ ]+ )?to cancel\)\s*$/i.exec(text);
  return cancel ? { text: text.slice(0, cancel.index), cancellable: true } : { text, cancellable: false };
}
