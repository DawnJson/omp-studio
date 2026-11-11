// 宠物的样子跟着所有任务走（docs/architecture/pet.md「状态」）：汇总当前状态，并从状态变化里认出成长事件。
// 纯逻辑，主进程在每次 taskState / taskRemoved 后调用。
import type { TaskId, TaskState, TaskStatus } from "../ipc.ts";
import type { Mood } from "./model.ts";

/** 持续状态的优先级：有任务等你 > 有任务出错 > 有任务在跑 > 空闲。done 是主进程叠加的一阵子，不在这里。 */
export function summarizeMood(tasks: readonly Pick<TaskState, "status">[]): Exclude<Mood, "done"> {
  let mood: Exclude<Mood, "done"> = "idle";
  for (const { status } of tasks) {
    if (status === "needs_you") return "waiting";
    if (status === "error") mood = "error";
    else if (mood === "idle" && (status === "running" || status === "starting")) mood = "running";
  }
  return mood;
}

/** 从一次状态变化里认出的事件；title 给说话用（只发状态和标题，不发对话内容，仓库所有者 2026-11-11 定）。 */
export interface PetTaskEvent {
  kind: "turn" | "gate" | "recovered" | "error";
  taskId: TaskId;
  title: string;
}

/**
 * 记住每个任务上一次的状态：
 * - running → idle：跑完一轮（turn）；这个任务之前出过错就再记一次 recovered。
 * - needs_you → 别的（不是 stopped / error）：等你确认的门处理掉了（gate）。
 * - 变成 error：出错（error），记下这个任务出过错。
 */
export class PetTaskTracker {
  readonly #last = new Map<TaskId, TaskStatus>();
  readonly #failed = new Set<TaskId>();

  update(state: Pick<TaskState, "id" | "status" | "title">): PetTaskEvent[] {
    const previous = this.#last.get(state.id);
    this.#last.set(state.id, state.status);
    if (previous === undefined || previous === state.status) return [];
    const event = (kind: PetTaskEvent["kind"]): PetTaskEvent => ({ kind, taskId: state.id, title: state.title });
    const events: PetTaskEvent[] = [];
    if (previous === "needs_you" && state.status !== "stopped" && state.status !== "error") events.push(event("gate"));
    if (previous === "running" && state.status === "idle") {
      events.push(event("turn"));
      if (this.#failed.delete(state.id)) events.push(event("recovered"));
    }
    if (state.status === "error") {
      this.#failed.add(state.id);
      events.push(event("error"));
    }
    return events;
  }

  forget(id: TaskId): void {
    this.#last.delete(id);
    this.#failed.delete(id);
  }
}

/**
 * 一次状态变化最多说一句：事件里有 recovered 就只说它（同一批里的 turn 不说），否则说最后一件不是 gate 的事件；
 * 处理掉确认门（gate）不说话。没有可说的返回 null。
 */
export function eventToVoice(events: readonly PetTaskEvent[]): PetTaskEvent | null {
  return (
    events.find((event) => event.kind === "recovered") ?? events.findLast((event) => event.kind !== "gate") ?? null
  );
}
