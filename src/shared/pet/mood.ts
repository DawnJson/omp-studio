// 宠物的样子跟着所有任务走（docs/architecture/pet.md「状态」）：汇总当前状态，并从状态变化里认出成长事件。
// 纯逻辑，主进程在每次 taskState / taskRemoved 后调用。
import type { TaskId, TaskState, TaskStatus } from "../ipc.ts";
import { fnv1a } from "./bones.ts";
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
export type PetTaskEvent =
  | { kind: "turn" | "gate" | "recovered" | "error"; taskId: TaskId; title: string }
  /** 新写出的输出 token（会话累计输出涨出来的部分）。 */
  | { kind: "output"; taskId: TaskId; title: string; tokens: number }
  /** 成就：一个待办阶段全部完成（detail = 阶段名）、任务开了 PR（detail = PR 号）。key 用来去重（同一项只算一次，跨重启）。 */
  | { kind: "todoPhase" | "pr"; taskId: TaskId; title: string; detail: string; key: string };

type TrackedState = Pick<TaskState, "id" | "status" | "title" | "sessionUsage" | "todoPhases" | "prNumber" | "cwd">;

/**
 * 全部条目都完成的待办阶段（放弃的算完成，至少一条真完成）。key = 阶段名 + 条目内容的哈希：
 * 同一任务后来又写了一份同名阶段（"实现""验证"）、内容不同的待办，做完还能再算一次。
 */
function finishedPhases(state: TrackedState): { name: string; key: string }[] {
  return state.todoPhases
    .filter(
      (phase) =>
        phase.tasks.some((task) => task.status === "completed") &&
        phase.tasks.every((task) => task.status === "completed" || task.status === "abandoned"),
    )
    .map((phase) => ({
      name: phase.name,
      key: fnv1a([phase.name, ...phase.tasks.map((task) => task.content)].join("\n")).toString(16),
    }));
}

/**
 * 记住每个任务上一次的状态：
 * - running → idle：跑完一轮（turn）；这个任务之前出过错就再记一次 recovered。
 * - needs_you → 别的（不是 stopped / error）：等你确认的门处理掉了（gate）。
 * - 变成 error：出错（error），记下这个任务出过错。
 * - 会话累计输出 token 涨了：output。第一次读到有用量的值只当基准（--resume 的旧会话一上来就是整段的累计）；
 *   变小 = 换了会话（/new 等），重新当基准。读到之前（null 或全 0）不算。
 * - 待办阶段从没做完变成做完、PR 号从无到有：todoPhase / pr。只在 agent 干活时算（这次或上一次状态是 running）：
 *   打开 / 恢复旧任务时待办和标题里的 PR 号是在 starting / idle 里才读出来的，那些只当基准，不当成刚做成的事。
 */
export class PetTaskTracker {
  readonly #last = new Map<TaskId, TaskStatus>();
  readonly #failed = new Set<TaskId>();
  readonly #output = new Map<TaskId, number>();
  readonly #phases = new Map<TaskId, Set<string>>();
  readonly #pr = new Map<TaskId, number | null>();

  update(state: TrackedState): PetTaskEvent[] {
    const events: PetTaskEvent[] = [];
    const base = { taskId: state.id, title: state.title };
    this.#trackOutput(state, events);
    const previous = this.#last.get(state.id);
    const working = state.status === "running" || previous === "running";
    const phases = finishedPhases(state);
    const knownPhases = this.#phases.get(state.id) ?? new Set<string>();
    if (working)
      for (const phase of phases)
        if (!knownPhases.has(phase.key))
          events.push({ kind: "todoPhase", ...base, detail: phase.name, key: `todo:${state.id}:${phase.key}` });
    this.#phases.set(state.id, new Set(phases.map((phase) => phase.key)));
    if (working && state.prNumber !== null && this.#pr.get(state.id) !== state.prNumber)
      events.push({ kind: "pr", ...base, detail: String(state.prNumber), key: `pr:${state.cwd}#${state.prNumber}` });
    this.#pr.set(state.id, state.prNumber);

    this.#last.set(state.id, state.status);
    if (previous === undefined || previous === state.status) return events;
    const event = (kind: "turn" | "gate" | "recovered" | "error"): PetTaskEvent => ({ kind, ...base });
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

  #trackOutput(state: TrackedState, events: PetTaskEvent[]): void {
    const tokens = state.sessionUsage?.tokens;
    if (tokens === undefined || tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) return;
    const seen = this.#output.get(state.id);
    this.#output.set(state.id, tokens.output);
    if (seen !== undefined && tokens.output > seen)
      events.push({ kind: "output", taskId: state.id, title: state.title, tokens: tokens.output - seen });
  }

  forget(id: TaskId): void {
    this.#last.delete(id);
    this.#failed.delete(id);
    this.#output.delete(id);
    this.#phases.delete(id);
    this.#pr.delete(id);
  }
}

/** 会说话的事件，按优先级：成就（PR、待办阶段）> 修好了 > 其余。 */
const voicePriority: readonly PetTaskEvent["kind"][] = ["pr", "todoPhase", "recovered"];

/**
 * 一次状态变化最多说一句：有成就或 recovered 按上面的优先级挑（同一批里的 turn 不说），否则说最后一件 turn / error；
 * 处理掉确认门（gate）和新写出的 token（output）不说话。没有可说的返回 null。
 */
export function eventToVoice(events: readonly PetTaskEvent[]): PetTaskEvent | null {
  for (const kind of voicePriority) {
    const found = events.find((event) => event.kind === kind);
    if (found !== undefined) return found;
  }
  return events.findLast((event) => event.kind === "turn" || event.kind === "error") ?? null;
}
