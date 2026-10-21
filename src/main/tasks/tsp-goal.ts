// TSP 任务的目标状态（TaskState.goal）：从 omp 输入框卡片上的"Goal …"事实行读状态和用量（shared/tsp/goal.ts），
// 目标文字从会话文件的 mode_change 记录读（只读，shared/omp-output/goal.ts）。记录要等 omp 写盘，读不到时先用 studio 自己
// 创建目标时发出去的那段字，之后每次用量变化再试。目标完成（事实行消失、记录是 complete）时通知一次。
import { open } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { TaskGoal } from "../../shared/ipc.ts";
import { parseGoalSession, type GoalRecord, type GoalSessionState } from "../../shared/omp-output/goal.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
import { deriveGoalFact, sameGoalFact, taskGoalFromFact, type GoalFact } from "../../shared/tsp/goal.ts";
import { log } from "../log/log.ts";

/** 目标记录每 1–2 秒追加一条，尾部这么多字节里一定有最新的（单条 < 2 KB）。 */
const TAIL_BYTES = 256 * 1024;
/** omp 写"完成"记录和事实行消失几乎同时：隔这么久再读。 */
const COMPLETE_SETTLE_MS = 400;

/** 读会话文件尾部并解析目标状态；文件不存在 / 读失败为 null。 */
export async function readGoalSession(file: string): Promise<GoalSessionState | null> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return parseGoalSession(buffer.toString("utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      log.warn("reading the goal record failed", { message: String(error) });
    return null;
  } finally {
    await handle?.close();
  }
}

export interface TspGoalHost {
  /** 当前会话文件；还没有为 null。 */
  sessionFile(): string | null;
  /** 目标变了，请发布状态。 */
  changed(): void;
  /** 目标完成了（事实行消失、记录是 complete）。 */
  completed(): void;
}

export class TspGoalTracker {
  readonly #host: TspGoalHost;
  #fact: GoalFact | null = null;
  #record: GoalRecord | null = null;
  #fallbackObjective = "";
  #goal: TaskGoal | null = null;
  #loading = false;
  #completedId: string | null = null;
  #epoch = 0;

  constructor(host: TspGoalHost) {
    this.#host = host;
  }

  get goal(): TaskGoal | null {
    return this.#goal;
  }

  /** studio 创建目标时发出去的文字：记录读到之前显示它。 */
  expectObjective(objective: string): void {
    this.#fallbackObjective = objective;
  }

  /** 新进程 / 进程退出：目标是会话里的东西，从头读。 */
  reset(): void {
    this.#epoch++;
    this.#fact = null;
    this.#record = null;
    this.#fallbackObjective = "";
    this.#update(null);
  }

  /** 文档变了：读事实行。输入框卡片不在文档里（选择器 / 弹窗开着）不下结论。 */
  observe(document: TspDocument): void {
    const { composer, fact } = deriveGoalFact(document);
    if (!composer) return;
    if (sameGoalFact(fact, this.#fact)) return;
    const hadGoal = this.#fact !== null;
    this.#fact = fact;
    if (fact === null) {
      this.#record = null;
      this.#fallbackObjective = "";
      this.#update(null);
      if (hadGoal) void this.#checkCompleted();
      return;
    }
    this.#recompute();
    if (this.#record === null) void this.#loadRecord();
  }

  #recompute(): void {
    this.#update(this.#fact === null ? null : taskGoalFromFact(this.#fact, this.#record, this.#fallbackObjective));
  }

  #update(next: TaskGoal | null): void {
    if (JSON.stringify(next) === JSON.stringify(this.#goal)) return;
    this.#goal = next;
    this.#host.changed();
  }

  async #loadRecord(): Promise<void> {
    const file = this.#host.sessionFile();
    if (file === null || this.#loading) return;
    this.#loading = true;
    const epoch = this.#epoch;
    try {
      const state = await readGoalSession(file);
      if (epoch !== this.#epoch || this.#fact === null || state === null) return;
      const record = state.record;
      if (record === null || state.cleared || record.status === "complete" || record.status === "dropped") return;
      this.#record = record;
      this.#recompute();
    } finally {
      this.#loading = false;
    }
  }

  async #checkCompleted(): Promise<void> {
    const file = this.#host.sessionFile();
    if (file === null) return;
    const epoch = this.#epoch;
    await sleep(COMPLETE_SETTLE_MS);
    if (epoch !== this.#epoch) return;
    const state = await readGoalSession(file);
    const record = state?.record;
    if (!record || record.status !== "complete" || record.id === this.#completedId) return;
    this.#completedId = record.id;
    this.#host.completed();
  }
}
