// 子代理行 / 作业磁贴的入场：同一批一起出现的错开 40ms 逐个进来；打开历史任务、切任务、滚动重挂载都不放。
//
// "新出现"由文档镜像判断（tsp-store 应用批次时调 recordBirths），不由组件挂载判断：
// 挂载只说明节点被画了，不说明它刚出现；omp 重画 Task 卡片时会把整棵子树 del 再 add（同样的 id，agent-progress 录制里 Alpha 被加了一百多次），
// 所以一个 id 在这个任务里只算出生一次（known），快照里已有的也算已出生。
import { useState, type CSSProperties } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { isRecord } from "../../../../shared/type-guards.ts";
import type { TspNode } from "../../../../shared/tsp/tsp.generated.ts";
import { useReducedMotion } from "./use-clock.ts";

/** 同一批里相邻两格的错开。 */
const STEP_MS = 40;
/** 错开最多排到第几格：再多的格子一起进来，免得最后一个等太久。 */
const MAX_INDEX = 5;
/** 出生后多久内挂载的组件才放入场（节点出生到 React 画出来之间的间隔远小于这个值）。 */
const FRESH_MS = 1000;

const JOB_TILE_ROLE = "omp.job.tile";
const SEP = "\u0000";

const births = new Map<string, { at: number; index: number }>();
const known = new Set<string>();

const keyOf = (taskId: TaskId, sf: string, id: string): string => `${taskId}${SEP}${sf}${SEP}${id}`;

function animated(node: { k: string; p?: unknown }): boolean {
  if (node.k === "agent") return true;
  return isRecord(node.p) && node.p["role"] === JOB_TILE_ROLE;
}

/** 一批消息里，某个任务的计数器：同一个父节点下这一批新出生的第几个。 */
export type BirthCounter = Map<string, number>;

/** 一条 add 操作加进来的子树：没出生过的子代理 / 磁贴记下出生时间和同批序号。 */
export function recordBirths(taskId: TaskId, sf: string, parentId: string, node: TspNode, counter: BirthCounter): void {
  const now = performance.now();
  for (const [key, birth] of births) if (now - birth.at > FRESH_MS * 2) births.delete(key);
  const walk = (current: TspNode, parent: string): void => {
    if (animated(current)) {
      const key = keyOf(taskId, sf, current.id);
      if (!known.has(key)) {
        known.add(key);
        const slot = `${sf}${SEP}${parent}`;
        const index = counter.get(slot) ?? 0;
        counter.set(slot, index + 1);
        births.set(key, { at: now, index });
      }
    }
    for (const child of current.c ?? []) walk(child, current.id);
  };
  walk(node, parentId);
}

/** 快照里已有的子代理 / 磁贴：算已出生（之后 omp 把它们 del 再 add 不是新出现）。 */
export function markKnown(taskId: TaskId, sf: string, nodes: Iterable<{ id: string; k: string; p: unknown }>): void {
  for (const node of nodes) if (animated(node)) known.add(keyOf(taskId, sf, node.id));
}

/** 任务被丢掉：清它的记录。 */
export function forgetBirths(taskId: TaskId): void {
  const prefix = `${taskId}${SEP}`;
  for (const key of known) if (key.startsWith(prefix)) known.delete(key);
  for (const key of births.keys()) if (key.startsWith(prefix)) births.delete(key);
}

export interface Entrance {
  className: string;
  /** 同批第几格（受上限约束）。减少动效时恒为 0，不错开。 */
  "data-enter": string;
  style: CSSProperties;
}

/** 组件首次挂载时问一次：刚出生就返回要展开到元素上的类名 / 延迟；否则 null（之后重画也不变）。 */
export function useEntrance(taskId: TaskId, sf: string, id: string): Entrance | null {
  const reduced = useReducedMotion();
  const [birth] = useState(() => {
    const found = births.get(keyOf(taskId, sf, id));
    return found !== undefined && performance.now() - found.at < FRESH_MS ? found : null;
  });
  if (birth === null) return null;
  const index = reduced ? 0 : Math.min(birth.index, MAX_INDEX);
  return {
    className: "tsp-enter",
    "data-enter": String(index * STEP_MS),
    style: { "--enter-delay": `${index * STEP_MS}ms` } as CSSProperties, // 自定义属性不在 CSSProperties 里
  };
}
