// 合批发往渲染进程的时机（TSP 节点批次、内置终端输出共用）：
// - 距上次发出已过 intervalMs：下一轮事件循环就发（setImmediate），同一次 pty 读到的内容照样合成一批，不额外等；
// - 刚发过：等到上次发出后 intervalMs 再发，连续流式输出时每秒最多约 1000 / intervalMs 批。
// 不用 setTimeout(0) 或"每次都等 intervalMs"：Windows 上 Node 的计时器按系统时钟格（约 15.6ms）对齐，
// setTimeout(16) 实测要等约 31ms，空闲后的第一条（按键回显、点按钮后的界面变化）白白晚两格（2026-10-25，task 录制原速回放）。

export interface BatchClock {
  now(): number;
  setImmediate(callback: () => void): unknown;
  clearImmediate(handle: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realBatchClock: BatchClock = {
  now: () => performance.now(),
  setImmediate: (callback) => setImmediate(callback),
  clearImmediate: (handle) => clearImmediate(handle as NodeJS.Immediate),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export class BatchTimer {
  readonly #intervalMs: number;
  readonly #fire: () => void;
  readonly #clock: BatchClock;
  #lastSent = Number.NEGATIVE_INFINITY;
  #pending: { kind: "immediate" | "timeout"; handle: unknown } | null = null;

  /** fire：到点时调用，由使用方把攒的内容发出去（发了就调 sent）。 */
  constructor(intervalMs: number, fire: () => void, clock: BatchClock = realBatchClock) {
    this.#intervalMs = intervalMs;
    this.#fire = fire;
    this.#clock = clock;
  }

  /** 有内容待发：安排一次 fire，已安排的不重复安排。 */
  schedule(): void {
    if (this.#pending !== null) return;
    const run = () => {
      this.#pending = null;
      this.#fire();
    };
    const wait = this.#lastSent + this.#intervalMs - this.#clock.now();
    this.#pending =
      wait <= 0
        ? { kind: "immediate", handle: this.#clock.setImmediate(run) }
        : { kind: "timeout", handle: this.#clock.setTimeout(run, wait) };
  }

  /** 使用方刚发出一批（到点发的、提前 flush 的都算）：取消待定的一次，从现在起算间隔。 */
  sent(): void {
    this.cancel();
    this.#lastSent = this.#clock.now();
  }

  cancel(): void {
    if (this.#pending === null) return;
    if (this.#pending.kind === "immediate") this.#clock.clearImmediate(this.#pending.handle);
    else this.#clock.clearTimeout(this.#pending.handle);
    this.#pending = null;
  }
}
