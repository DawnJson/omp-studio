// 终端输出合并：pty 的 data 事件很碎（一个按键回显、一行日志就是一次），逐条走 IPC 会把渲染进程淹没。
// 发送时机见 platform/batch-timer.ts（空闲后的第一批下一轮事件循环就发，连续输出时按 intervalMs 限速）；
// 攒够 maxChars 立刻发。不 import electron，单元测试用假时钟。
import { BatchTimer, realBatchClock, type BatchClock } from "../platform/batch-timer.ts";

export interface BatcherOptions {
  intervalMs: number;
  /** 攒够这么多字符就立刻发，不等定时器。 */
  maxChars: number;
}

export class OutputBatcher {
  readonly #emit: (data: string) => void;
  readonly #options: BatcherOptions;
  readonly #timer: BatchTimer;
  #chunks: string[] = [];
  #size = 0;

  constructor(emit: (data: string) => void, options: BatcherOptions, clock: BatchClock = realBatchClock) {
    this.#emit = emit;
    this.#options = options;
    this.#timer = new BatchTimer(options.intervalMs, () => this.flush(), clock);
  }

  push(chunk: string): void {
    if (chunk === "") return;
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    if (this.#size >= this.#options.maxChars) this.flush();
    else this.#timer.schedule();
  }

  /** 立刻发出已攒的内容（没有就什么也不做）。shell 退出前调用，保证输出先于退出事件到达。 */
  flush(): void {
    this.#timer.cancel();
    if (this.#chunks.length === 0) return;
    const data = this.#chunks.join("");
    this.#chunks = [];
    this.#size = 0;
    this.#timer.sent();
    this.#emit(data);
  }

  /** 丢掉还没发的内容。重新打开面板时这部分已经包含在 backlog 里，再发一次会重复。 */
  discard(): void {
    this.#timer.cancel();
    this.#chunks = [];
    this.#size = 0;
  }
}
