// 泳道的纯函数：子代理归到哪一轮、行的顺序（父在前、子缩进）、时间轴的范围、主代理的工具节奏。不碰 DOM。
import type { SubagentLane } from "../../../../shared/subagents.ts";
import type { Turn } from "../conversation/model.ts";

export interface LaneRow {
  lane: SubagentLane;
  /** 嵌套深度：顶层 0。 */
  depth: number;
}

/** 父在前、子紧跟其后（缩进一层），同级按开始时间。父不在列表里的当顶层。 */
export function orderLanes(lanes: readonly SubagentLane[]): LaneRow[] {
  const ids = new Set(lanes.map((lane) => lane.id));
  const children = new Map<string, SubagentLane[]>();
  const roots: SubagentLane[] = [];
  for (const lane of lanes) {
    if (lane.parentId !== null && ids.has(lane.parentId)) {
      const siblings = children.get(lane.parentId) ?? [];
      siblings.push(lane);
      children.set(lane.parentId, siblings);
    } else roots.push(lane);
  }
  const rows: LaneRow[] = [];
  const visit = (lane: SubagentLane, depth: number) => {
    rows.push({ lane, depth });
    for (const child of children.get(lane.id) ?? []) visit(child, depth + 1);
  };
  const byStart = (a: SubagentLane, b: SubagentLane) => a.startedAt - b.startedAt;
  for (const root of roots.toSorted(byStart)) visit(root, 0);
  return rows;
}

/**
 * 每个子代理归到"开始时间不晚于它的最后一轮"（主进程接收时间对主进程接收时间，同一个时钟）。
 * 第一轮之前开始的归第一轮。没有子代理的轮不在结果里。传入上一次的结果：内容没变的数组沿用旧引用，TurnView 的 memo 才有用。
 */
export function assignLanesToTurns(
  turns: readonly Turn[],
  lanes: readonly SubagentLane[],
  previous?: ReadonlyMap<string, readonly SubagentLane[]>,
): Map<string, readonly SubagentLane[]> {
  const grouped = new Map<string, SubagentLane[]>();
  if (turns.length > 0) {
    for (const lane of lanes) {
      let owner = turns[0]!;
      for (const turn of turns) {
        if (turn.startedAt <= lane.startedAt) owner = turn;
        else break;
      }
      const list = grouped.get(owner.key) ?? [];
      list.push(lane);
      grouped.set(owner.key, list);
    }
  }
  const result = new Map<string, readonly SubagentLane[]>();
  for (const [key, list] of grouped) {
    const old = previous?.get(key);
    result.set(key, old && old.length === list.length && old.every((lane, index) => lane === list[index]) ? old : list);
  }
  return result;
}

export interface Span {
  start: number;
  end: number;
}

const MIN_SPAN_MS = 1000;

/** 时间轴范围：本轮开始 → 最晚的那个结束（本轮结束、子代理结束、还在跑的取现在）。后台子代理可以比这一轮活得更久。 */
export function timelineSpan(turn: Turn, lanes: readonly SubagentLane[], now: number, live: boolean): Span {
  const start = turn.startedAt;
  let end = live ? now : turn.endedAt;
  for (const lane of lanes) {
    end = Math.max(end, lane.endedAt ?? now);
    const lastTool = lane.tools.at(-1);
    if (lastTool) end = Math.max(end, lastTool.at);
  }
  return { start, end: Math.max(end, start + MIN_SPAN_MS) };
}

/** 时间 → 轴上的位置（0–100，超出范围夹住）。 */
export function percentAt(span: Span, time: number): number {
  return Math.min(100, Math.max(0, ((time - span.start) / (span.end - span.start)) * 100));
}

export interface ToolMark {
  start: number;
  end: number;
  failed: boolean;
}

/** 主代理的工具节奏：这一轮里每次工具调用的起止（只有当次运行里收到的有时间，历史里的没有）。 */
export function mainToolMarks(turn: Turn): ToolMark[] {
  const marks: ToolMark[] = [];
  for (const step of turn.steps) {
    if (step.kind !== "tool" || step.startedAt === null) continue;
    marks.push({ start: step.startedAt, end: step.endedAt ?? step.startedAt, failed: step.status === "error" });
  }
  return marks;
}

export interface RecordSpan<T> {
  /** messages[0] 的绝对序号。 */
  from: number;
  messages: T[];
}

/** 把主进程返回的一段（从绝对序号 incoming.from 起）接到已有的记录后面；接不上（记录被重置、被截断）就整个换掉。没有新增时返回原对象。 */
export function mergeRecord<T>(held: RecordSpan<T> | null, incoming: RecordSpan<T>): RecordSpan<T> {
  if (held && incoming.from >= held.from && incoming.from <= held.from + held.messages.length) {
    if (incoming.messages.length === 0 && incoming.from === held.from + held.messages.length) return held;
    return { from: held.from, messages: [...held.messages.slice(0, incoming.from - held.from), ...incoming.messages] };
  }
  return incoming;
}
