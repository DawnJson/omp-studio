// checklist 节点的数据（纯函数，test/tsp-checklist.test.ts 用 omp 录制的帧覆盖）。
import type { TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { asArray, asString } from "../props-util.ts";

export type ItemStatus = "pending" | "active" | "done" | "dropped" | "blocked";

function itemStatus(value: unknown): ItemStatus {
  return value === "active" || value === "done" || value === "dropped" || value === "blocked" ? value : "pending";
}

export interface Item {
  id: string;
  text: TspText | undefined;
  status: ItemStatus;
  note: TspText | undefined;
}

export interface Phase {
  id: string;
  title: TspText | undefined;
  items: Item[];
  collapsed: boolean | undefined;
}

export function readPhases(value: unknown): Phase[] {
  return asArray(value)
    .filter(isRecord)
    .map((phase) => ({
      id: asString(phase.id) ?? "",
      title: phase.title as TspText | undefined,
      collapsed: typeof phase.collapsed === "boolean" ? phase.collapsed : undefined,
      items: asArray(phase.items)
        .filter(isRecord)
        .filter((item) => typeof item.id === "string")
        .map((item) => ({
          id: item.id as string,
          text: item.text as TspText | undefined,
          status: itemStatus(item.status),
          note: item.note as TspText | undefined,
        })),
    }));
}

export const finished = (item: Item): boolean => item.status === "done" || item.status === "dropped";

/** 阶段行最前面的标记：至少一项且全部做完（done / dropped）是对勾，和待办板一致；否则是进度环。omp 的帧里阶段没有图标，这是 studio 自己画的。 */
export function phaseMarkKind(done: number, total: number): "check" | "ring" {
  return total > 0 && done === total ? "check" : "ring";
}
