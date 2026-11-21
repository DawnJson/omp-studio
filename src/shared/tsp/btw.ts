// 旁路提问（`/btw`）读 omp 的 TSP 文档：纯函数，主进程（驱动 omp、维护镜像）和渲染进程（藏掉 omp 自己的弹窗）共用。
//
// 依据是 omp 18.12.5 的实测（真实 omp，deepseek/deepseek-v4-flash，临时 PI_CODING_AGENT_DIR；录制 fixtures/tsp/btw.jsonl，
// test/tsp-btw.test.ts 逐帧验证，docs/architecture/tsp-btw.md 有完整的事件序列）：
// - `/btw <问题>` 不进主对话：main 里没有任何节点（没有 omp.user，也没有排队），主轮在流式输出时照常提问；只是在 layer 里加一个
//   **modal 弹窗** `overlay role="omp.overlay.btwHistory"`，里面是这个话题的问答（`omp.btw.thread` → 每一问一个 `omp.btw.turn`：
//   `omp.btw.question` / `omp.btw.followup` 的 md、`omp.btw.meta` 的状态行、`omp.btw.answer` 里的 md 答案或 `omp.btw.pending`
//   的 "Thinking…"、失败时的 `omp.btw.error`）。答案流式到达：md 的 `text` 追加。
// - 有两个以上话题（或裸 `/btw` 打开历史）时弹窗左边多一个 `list role="omp.btw.list*"`：item 的 id 以话题 id 结尾，`selected` 是
//   选中项；右边只有**选中话题**的问答。只有一个话题时没有 list，节点里没有话题 id（所以话题 id 要靠会话旁边的
//   `btw-history/` 目录补，见 main/tsp/btw-history.ts）。
// - 弹窗底栏是 `omp.btn` 按钮，`actions.click` 是动作名：stop（回答中）/ close / follow-up / copy-answer；追问时多出
//   `omp.btw.composer` 里的 `input`（`sendable` 为 false 时 `send` 事件是空操作，所以先发 `edit` 填字再点 `send` 按钮）和 discard / send。
// - 弹窗不会自己消失：要发 `action close`（omp 回头把焦点还给主输入框）。主输入框的 `send` 在弹窗开着时照常提交（追问输入框打开时除外）。
// - omp 19（实测 19.0.1，2026-11-21，录制 fixtures/tsp/btw-19.jsonl）：`/btw <问题>` 不再开弹窗，改在 main 末尾插一张**便签**
//   （`col role="omp.btw.note"`，被点成输入框目标时 role 是 `omp.btw.note.active`，收起时整张换成一行 `omp.btw.note.folded`）：
//   头上 `omp.btw.note.question` 是话题（record.title ?? 第一问），每一问一个 `omp.btw.note.turn`（第二问起开头是 `omp.btw.followup`
//   的 md，答案 md 或 `omp.btw.pending`，失败时 `omp.btw.error`），最后 `omp.btw.note.status` 是**最新一问**的状态词（完成时没有这一行）。
//   便签里没有话题 id；点击和右键菜单发 `action`，`act` 是 `btw-stop` / `btw-focus` / `btw-fold` 等（omp 的 btw-note.ts）。
//   裸 `/btw` 仍开上面那个历史弹窗，追问照旧走弹窗。
// role、动作名、状态词都是 omp 自己的、不在 TSP 规范里：omp 改名这里就失效，所以判断全部集中在这个文件（gate.ts 同理）。
import type { BtwHistoryRecord, BtwHistoryTurn, BtwStatus } from "../omp-wire/rpc-wire.generated.ts";
import { isRecord } from "../type-guards.ts";
import { applyBtwEvent, latestTurn, type BtwUiEvent } from "../btw.ts";
import {
  liveSurfaces,
  nodeRole,
  spansText,
  treeNodes,
  type DocNode,
  type DocSurface,
  type TspDocument,
} from "./document.ts";

const BTW_OVERLAY_ROLE = "omp.overlay.btwHistory";
/** 展开的便签根节点的 role（被点成输入框目标时是 `.active`）。 */
export const BTW_NOTE_ROLES = ["omp.btw.note", "omp.btw.note.active"] as const;
const NOTE_ROLES: ReadonlySet<string> = new Set(BTW_NOTE_ROLES);
const FOLDED_NOTE_ROLE = "omp.btw.note.folded";
const NOTE_QUESTION_ROLE = "omp.btw.note.question";
const NOTE_TURN_ROLE = "omp.btw.note.turn";
const NOTE_STATUS_ROLE = "omp.btw.note.status";
/** 便签上"停止回答"的动作（右键菜单项的 id，发成 `action` 事件的 `act`）。 */
const NOTE_STOP_ACT = "btw-stop";
const THREAD_ROLE = "omp.btw.thread";
const TURN_ROLE = "omp.btw.turn";
const QUESTION_ROLE = "omp.btw.question";
const FOLLOW_UP_ROLE = "omp.btw.followup";
const META_ROLE = "omp.btw.meta";
const ANSWER_ROLE = "omp.btw.answer";
const PENDING_ROLE = "omp.btw.pending";
const ERROR_ROLE = "omp.btw.error";
const COMPOSER_ROLE = "omp.btw.composer";
const LIST_ROLE_PREFIX = "omp.btw.list";
const BUTTON_ROLE = "omp.btn";

/** 弹窗按钮的 `actions.click`。 */
export type BtwAct = "stop" | "close" | "follow-up" | "send" | "discard";
const ACTS: ReadonlySet<string> = new Set<BtwAct>(["stop", "close", "follow-up", "send", "discard"]);

/** 弹窗的话题 id 没法从节点里读到（只有一个话题）、磁盘上的记录也还没落下来时，镜像里的临时 id。 */
export const PROVISIONAL_BTW_PREFIX = "live:";
/** 临时 id 和磁盘记录对上时，允许的时钟误差（同一台机器，只是保守）。 */
const CLOCK_SKEW_MS = 10_000;

export function isProvisionalBtwId(id: string): boolean {
  return id.startsWith(PROVISIONAL_BTW_PREFIX);
}

/** 渲染进程：这个节点是 omp 的旁路提问弹窗或便签（含收起的一行），studio 的面板已经显示了它，不画。 */
export function isBtwHiddenNode(node: { readonly p: Readonly<Record<string, unknown>> }): boolean {
  const role = node.p["role"];
  return role === BTW_OVERLAY_ROLE || role === FOLDED_NOTE_ROLE || (typeof role === "string" && NOTE_ROLES.has(role));
}

// ───────── 读弹窗 ─────────

export interface BtwViewTurn {
  kind: "question" | "followUp";
  question: string;
  status: BtwStatus;
  /** 答案文字（流式中是目前收到的部分）；回答中还没有字时为 ""。 */
  answer: string;
  error: string | undefined;
}

export interface BtwViewList {
  /** list 节点 id（`select` 事件的目标）。 */
  id: string;
  /** 选中的话题 id（item id 的最后一段）。 */
  selected: string | null;
  items: { nodeId: string; recordId: string; question: string; running: boolean }[];
}

export interface BtwView {
  sf: string;
  overlayId: string;
  list: BtwViewList | null;
  turns: BtwViewTurn[];
  /** 追问输入框；没在追问为 null。 */
  composer: { id: string; text: string } | null;
  /** 按钮节点 id（`action` 事件的目标），当前没有的动作不在。 */
  buttons: Partial<Record<BtwAct, string>>;
}

/** 弹窗每一问的状态词（`omp.btw.meta` 的 spans）：完成时只有时间；其余是 Answering / Cancelled / Failed / Interrupted。 */
export function btwStatusFromMeta(text: string): BtwStatus {
  const lower = text.toLowerCase();
  if (lower.includes("answering")) return "running";
  if (lower.includes("cancelled") || lower.includes("canceled")) return "cancelled";
  if (lower.includes("failed") || lower.includes("error")) return "error";
  if (lower.includes("interrupted")) return "interrupted";
  return "complete";
}

function subtree(surface: DocSurface, rootId: string, visit: (node: DocNode) => void): void {
  const stack = [rootId];
  while (stack.length > 0) {
    const node = surface.nodes.get(stack.pop()!);
    if (!node) continue;
    visit(node);
    for (let index = node.c.length - 1; index >= 0; index -= 1) stack.push(node.c[index]!);
  }
}

function nodeText(node: DocNode): string {
  const text = node.p["text"];
  return typeof text === "string" ? text : spansText(node.p["spans"]);
}

function readTurn(surface: DocSurface, turn: DocNode): BtwViewTurn | null {
  let question: string | null = null;
  let kind: BtwViewTurn["kind"] = "question";
  let meta = "";
  let error: string | undefined;
  const answers: string[] = [];
  for (const id of turn.c) {
    const child = surface.nodes.get(id);
    if (!child) continue;
    const role = nodeRole(child);
    if (role === QUESTION_ROLE || role === FOLLOW_UP_ROLE) {
      question = nodeText(child);
      kind = role === FOLLOW_UP_ROLE ? "followUp" : "question";
    } else if (role === META_ROLE) {
      meta = nodeText(child);
    } else if (role === ERROR_ROLE) {
      error = nodeText(child);
    } else if (role === ANSWER_ROLE) {
      subtree(surface, child.id, (node) => {
        if (node.id === child.id || node.k === "col" || nodeRole(node) === PENDING_ROLE) return;
        const text = nodeText(node);
        if (text !== "") answers.push(text);
      });
    }
  }
  if (question === null) return null;
  return { kind, question, status: btwStatusFromMeta(meta), answer: answers.join("\n\n"), error };
}

function readList(surface: DocSurface, node: DocNode): BtwViewList {
  const items: BtwViewList["items"] = [];
  for (const id of node.c) {
    const item = surface.nodes.get(id);
    if (!item || item.k !== "item") continue;
    items.push({
      nodeId: item.id,
      recordId: item.id.slice(item.id.lastIndexOf("/") + 1),
      question: spansText(item.p["label"]),
      running: spansText(item.p["value"]).toLowerCase().includes("answering"),
    });
  }
  const selected = node.p["selected"];
  return {
    id: node.id,
    selected: typeof selected === "string" ? selected.slice(selected.lastIndexOf("/") + 1) : null,
    items,
  };
}

/** layer 里的旁路提问弹窗；没开为 null。 */
export function findBtwView(doc: TspDocument): BtwView | null {
  let found: BtwView | null = null;
  for (const surface of liveSurfaces(doc)) {
    for (const overlay of treeNodes(surface)) {
      if (overlay.k !== "overlay" || nodeRole(overlay) !== BTW_OVERLAY_ROLE) continue;
      const view: BtwView = {
        sf: surface.id,
        overlayId: overlay.id,
        list: null,
        turns: [],
        composer: null,
        buttons: {},
      };
      subtree(surface, overlay.id, (node) => {
        const role = nodeRole(node);
        if (role === THREAD_ROLE) {
          for (const id of node.c) {
            const child = surface.nodes.get(id);
            if (child && nodeRole(child) === TURN_ROLE) {
              const turn = readTurn(surface, child);
              if (turn) view.turns.push(turn);
            }
          }
        } else if (role !== null && role.startsWith(LIST_ROLE_PREFIX) && node.k === "list") {
          view.list = readList(surface, node);
        } else if (role === COMPOSER_ROLE) {
          for (const id of node.c) {
            const input = surface.nodes.get(id);
            if (input?.k === "input") view.composer = { id: input.id, text: nodeText(input) };
          }
        } else if (role === BUTTON_ROLE) {
          const actions = node.p["actions"];
          const act = isRecord(actions) ? actions["click"] : undefined;
          if (typeof act === "string" && ACTS.has(act)) view.buttons[act as BtwAct] = node.id;
        }
      });
      found = view;
    }
  }
  return found;
}

/** 弹窗里有没有回答中的一问。 */
export function btwViewRunning(view: BtwView): boolean {
  return view.turns.some((turn) => turn.status === "running");
}

// ───────── omp 19 的便签 ─────────

/** main 里一张展开的便签（收起的那一行没有内容，不读）。 */
export interface BtwNote {
  sf: string;
  /** 便签节点 id（`action` 事件的目标）。 */
  id: string;
  turns: BtwViewTurn[];
}

function readNoteTurn(surface: DocSurface, turn: DocNode, question: string, status: BtwStatus): BtwViewTurn {
  let kind: BtwViewTurn["kind"] = "question";
  let error: string | undefined;
  const answers: string[] = [];
  for (const id of turn.c) {
    const child = surface.nodes.get(id);
    if (!child) continue;
    const role = nodeRole(child);
    if (role === FOLLOW_UP_ROLE) {
      question = nodeText(child);
      kind = "followUp";
    } else if (role === ERROR_ROLE) {
      error = nodeText(child);
    } else if (role !== PENDING_ROLE) {
      subtree(surface, child.id, (node) => {
        if (node.k === "col" || nodeRole(node) === PENDING_ROLE) return;
        const text = nodeText(node);
        if (text !== "") answers.push(text);
      });
    }
  }
  return { kind, question, status, answer: answers.join("\n\n"), error };
}

/**
 * main 里展开的旁路提问便签，按文档顺序。状态词只有最新一问的；更早的一问失败的有 `omp.btw.error`，其余按 complete 算
 * （镜像里已有的状态由 viewToRecord 保留）。
 */
export function findBtwNotes(doc: TspDocument): BtwNote[] {
  const notes: BtwNote[] = [];
  for (const surface of liveSurfaces(doc)) {
    for (const note of treeNodes(surface)) {
      const role = nodeRole(note);
      if (role === null || !NOTE_ROLES.has(role)) continue;
      let topic = "";
      let status = "";
      const turnNodes: DocNode[] = [];
      subtree(surface, note.id, (node) => {
        const inner = nodeRole(node);
        if (inner === NOTE_QUESTION_ROLE) topic = nodeText(node);
        else if (inner === NOTE_STATUS_ROLE) status = nodeText(node);
        else if (inner === NOTE_TURN_ROLE) turnNodes.push(node);
      });
      const latest = btwStatusFromMeta(status);
      const turns = turnNodes.map((turn, index) => {
        const last = index === turnNodes.length - 1;
        const read = readNoteTurn(surface, turn, topic, last ? latest : "complete");
        return !last && read.error !== undefined ? { ...read, status: "error" as const } : read;
      });
      notes.push({ sf: surface.id, id: note.id, turns });
    }
  }
  return notes;
}

/** 便签上的"停止回答"。 */
export function btwNoteStopEvent(note: BtwNote): { ev: "action"; sf: string; id: string; act: string } {
  return { ev: "action", sf: note.sf, id: note.id, act: NOTE_STOP_ACT };
}

// ───────── 要发给 omp 的事件 ─────────

type ButtonEvent = { ev: "action"; sf: string; id: string; act: BtwAct };

/** 点弹窗的一个按钮；现在没有这个按钮为 null。 */
export function btwButtonEvent(view: BtwView, act: BtwAct): ButtonEvent | null {
  const id = view.buttons[act];
  return id === undefined ? null : { ev: "action", sf: view.sf, id, act };
}

/** 历史列表里选中一个话题。 */
export function btwSelectEvent(
  view: BtwView,
  recordId: string,
): { ev: "select"; sf: string; id: string; item: string } | null {
  const item = view.list?.items.find((candidate) => candidate.recordId === recordId);
  return view.list && item ? { ev: "select", sf: view.sf, id: view.list.id, item: item.nodeId } : null;
}

/** 往追问输入框填字（输入框是空的：`edit` 把 [0,0) 换成文字）。 */
export function btwFillEvent(
  view: BtwView,
  text: string,
): { ev: "edit"; sf: string; id: string; from: 0; to: 0; text: string; cursor: number; len: 0 } | null {
  return view.composer
    ? { ev: "edit", sf: view.sf, id: view.composer.id, from: 0, to: 0, text, cursor: text.length, len: 0 }
    : null;
}

/** 规整问题文字，用来对"弹窗里的问题"和"我们发出的问题"（omp 会去掉首尾空白）。 */
export function normalizeBtwQuestion(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// ───────── 弹窗 / 便签 → 镜像里的记录 ─────────

/** 弹窗或便签里的一个话题（便签没有 list）。 */
export type BtwTopicView = { readonly turns: readonly BtwViewTurn[]; readonly list?: BtwViewList | null };

function turnOf(view: BtwViewTurn, base: BtwHistoryTurn | undefined, now: number, last: boolean): BtwHistoryTurn {
  // 便签只画最新一问的状态词：更早的一问以镜像里已经收尾的状态为准（比如被取消的那一问）。
  const status =
    !last && base !== undefined && base.question === view.question && base.status !== "running"
      ? base.status
      : view.status;
  const same =
    base !== undefined &&
    base.question === view.question &&
    base.answer === view.answer &&
    base.status === status &&
    base.error === view.error;
  return {
    question: view.question,
    answer: view.answer,
    status,
    createdAt: base?.createdAt ?? now,
    updatedAt: same ? base.updatedAt : now,
    ...(view.error !== undefined ? { error: view.error } : {}),
  };
}

/** 弹窗或便签里的这个话题 → BtwHistoryRecord；`base` 是镜像里已有的同 id 记录（保留创建时间、leafId）。 */
export function viewToRecord(
  view: BtwTopicView,
  id: string,
  base: BtwHistoryRecord | undefined,
  now: number,
): BtwHistoryRecord | null {
  const [first, ...rest] = view.turns;
  if (!first) return null;
  const head = turnOf(first, base, now, rest.length === 0);
  const followUps = rest.map((turn, index) => turnOf(turn, base?.followUps?.[index], now, index === rest.length - 1));
  return { id, leafId: base?.leafId ?? null, ...head, ...(followUps.length > 0 ? { followUps } : {}) };
}

/** 弹窗里的话题对应镜像里的哪条：list 选中项的 id；只有一个话题（没有 list）或便签时按第一问的文字找，最新的优先。 */
export function resolveViewRecordId(view: BtwTopicView, records: readonly BtwHistoryRecord[]): string | null {
  if (view.list?.selected) return view.list.selected;
  const first = view.turns[0];
  if (!first) return null;
  const wanted = normalizeBtwQuestion(first.question);
  let best: BtwHistoryRecord | null = null;
  for (const record of records) {
    if (normalizeBtwQuestion(record.question) !== wanted) continue;
    if (best === null || record.createdAt > best.createdAt) best = record;
  }
  return best?.id ?? null;
}

/**
 * 镜像从 prev 变成 next 要发给渲染进程的事件：只是最新一问的答案在末尾追加 → `delta`（和 rpc 的 btw_delta 一样），其余一律整条 `record`。
 * prev 为 undefined = 新记录。
 */
export function btwEventsFor(prev: BtwHistoryRecord | undefined, next: BtwHistoryRecord): BtwUiEvent[] {
  if (prev === undefined) return [{ type: "record", record: next }];
  if (JSON.stringify(prev) === JSON.stringify(next)) return [];
  const before = latestTurn(prev);
  const after = latestTurn(next);
  if (after.answer.length > before.answer.length && after.answer.startsWith(before.answer)) {
    const delta: BtwUiEvent = { type: "delta", recordId: next.id, delta: after.answer.slice(before.answer.length) };
    const projected = applyBtwEvent([prev], delta)[0];
    // 只有答案在变才发 delta（渲染进程的投影不带 updatedAt，所以比较时不算它）。
    if (projected && JSON.stringify(withoutUpdatedAt(projected)) === JSON.stringify(withoutUpdatedAt(next)))
      return [delta];
  }
  return [{ type: "record", record: next }];
}

function withoutUpdatedAt(record: BtwHistoryRecord): BtwHistoryRecord {
  return {
    ...record,
    updatedAt: 0,
    ...(record.followUps ? { followUps: record.followUps.map((turn) => ({ ...turn, updatedAt: 0 })) } : {}),
  };
}

// ───────── 磁盘上的历史（会话旁边的 btw-history/） ─────────

/** 单个话题文件的上限；超过的不读（正常的话题远小于它）。 */
export const BTW_ENTRY_MAX_BYTES = 1_000_000;

const STATUSES: ReadonlySet<string> = new Set<BtwStatus>(["running", "complete", "cancelled", "error", "interrupted"]);

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function parseTurn(value: unknown): BtwHistoryTurn | null {
  if (!isRecord(value)) return null;
  const { question, answer, status, error } = value;
  const createdAt = finite(value["createdAt"]);
  const updatedAt = finite(value["updatedAt"]);
  if (typeof question !== "string" || typeof answer !== "string" || typeof status !== "string") return null;
  if (!STATUSES.has(status) || createdAt === null || updatedAt === null) return null;
  return {
    question,
    answer,
    status: status as BtwStatus,
    createdAt,
    updatedAt,
    ...(typeof error === "string" ? { error } : {}),
  };
}

/** `btw-history/entry-<id>.json`（omp 18.12.5 实测，形状同 rpc 的 BtwHistoryRecord）；认不出的返回 null，调用方记日志。 */
export function parseBtwEntry(text: string): BtwHistoryRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const head = parseTurn(raw);
  if (!head || !isRecord(raw) || typeof raw["id"] !== "string" || raw["id"] === "") return null;
  const followUps: BtwHistoryTurn[] = [];
  if (raw["followUps"] !== undefined) {
    if (!Array.isArray(raw["followUps"])) return null;
    for (const item of raw["followUps"] as unknown[]) {
      const turn = parseTurn(item);
      if (!turn) return null;
      followUps.push(turn);
    }
  }
  const leafId = raw["leafId"];
  return {
    id: raw["id"],
    leafId: typeof leafId === "string" ? leafId : null,
    ...head,
    ...(followUps.length > 0 ? { followUps } : {}),
  };
}

/** 磁盘上最新一问还是 running 的：写它的进程已经不在（omp 读历史时也这么标）→ interrupted。 */
function interruptedOnDisk(record: BtwHistoryRecord): BtwHistoryRecord {
  const mark = <T extends BtwHistoryTurn>(turn: T): T =>
    turn.status === "running" ? { ...turn, status: "interrupted" as const } : turn;
  const followUps = record.followUps;
  if (followUps && followUps.length > 0)
    return {
      ...record,
      followUps: followUps.map((turn, index) => (index === followUps.length - 1 ? mark(turn) : turn)),
    };
  return mark(record);
}

export interface BtwMerge {
  /** 新的镜像，按创建时间从新到旧。 */
  records: BtwHistoryRecord[];
  /** 临时 id → 磁盘上的真 id。 */
  remap: Map<string, string>;
}

/**
 * 磁盘记录并进镜像：临时 id 的记录按"第一问相同、磁盘记录不早于它"换成磁盘上的 id；同 id 时，镜像里最新一问还在回答中
 * （弹窗是实时的、磁盘上的答案要等收尾才写）以镜像为准，只借磁盘的 createdAt / leafId；其余以磁盘为准；只在镜像里的保留。
 * 磁盘上还是 running、镜像里没有在跑的：写它的进程没了，标成 interrupted。
 */
export function mergeBtwDisk(mirror: readonly BtwHistoryRecord[], disk: readonly BtwHistoryRecord[]): BtwMerge {
  const remap = new Map<string, string>();
  const claimed = new Set<string>();
  const mirrorIds = new Set(mirror.map((record) => record.id));
  for (const record of mirror) {
    if (!isProvisionalBtwId(record.id)) continue;
    const wanted = normalizeBtwQuestion(record.question);
    const hit = disk.find(
      (candidate) =>
        !mirrorIds.has(candidate.id) &&
        !claimed.has(candidate.id) &&
        normalizeBtwQuestion(candidate.question) === wanted &&
        candidate.createdAt >= record.createdAt - CLOCK_SKEW_MS,
    );
    if (hit) {
      remap.set(record.id, hit.id);
      claimed.add(hit.id);
    }
  }
  const byId = new Map<string, BtwHistoryRecord>();
  for (const record of mirror) {
    const id = remap.get(record.id) ?? record.id;
    const onDisk = disk.find((candidate) => candidate.id === id);
    if (!onDisk) {
      byId.set(id, { ...record, id });
      continue;
    }
    const mirrorTurns = 1 + (record.followUps?.length ?? 0);
    const diskTurns = 1 + (onDisk.followUps?.length ?? 0);
    if (diskTurns > mirrorTurns) {
      // 磁盘上的话题比镜像多一问（终端里的 omp 追问过）：以磁盘为准。
      byId.set(id, interruptedOnDisk(onDisk));
    } else if (
      diskTurns < mirrorTurns ||
      latestTurn(record).status === "running" ||
      latestTurn(onDisk).status === "running"
    ) {
      // 镜像更新：弹窗是实时的，磁盘上的答案要等收尾才写（回答中、磁盘落后一拍）。只借磁盘的创建时间和 leafId。
      byId.set(id, { ...record, id, createdAt: onDisk.createdAt, leafId: onDisk.leafId });
    } else {
      byId.set(id, onDisk);
    }
  }
  for (const record of disk) if (!byId.has(record.id)) byId.set(record.id, interruptedOnDisk(record));
  const records = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  return { records, remap };
}
