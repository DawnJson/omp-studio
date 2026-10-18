// 终端输出合并：pty 的 data 事件很碎（一个按键回显、一行日志就是一次），逐条走 IPC 会把渲染进程淹没。
// 攒到 intervalMs 或 maxChars 就发一次；不 import electron，单元测试用假定时器。

export interface BatcherTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BatcherOptions {
  intervalMs: number;
  /** 攒够这么多字符就立刻发，不等定时器。 */
  maxChars: number;
}

export class OutputBatcher {
  readonly #emit: (data: string) => void;
  readonly #options: BatcherOptions;
  readonly #timers: BatcherTimers;
  #chunks: string[] = [];
  #size = 0;
  #timer: unknown = null;

  constructor(
    emit: (data: string) => void,
    options: BatcherOptions,
    timers: BatcherTimers = {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as never),
    },
  ) {
    this.#emit = emit;
    this.#options = options;
    this.#timers = timers;
  }

  push(chunk: string): void {
    if (chunk === "") return;
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    if (this.#size >= this.#options.maxChars) {
      this.flush();
    } else if (this.#timer === null) {
      this.#timer = this.#timers.setTimeout(() => {
        this.#timer = null;
        this.flush();
      }, this.#options.intervalMs);
    }
  }

  /** 立刻发出已攒的内容（没有就什么也不做）。shell 退出前调用，保证输出先于退出事件到达。 */
  flush(): void {
    this.#clearTimer();
    if (this.#chunks.length === 0) return;
    const data = this.#chunks.join("");
    this.#chunks = [];
    this.#size = 0;
    this.#emit(data);
  }

  /** 丢掉还没发的内容。重新打开面板时这部分已经包含在 backlog 里，再发一次会重复。 */
  discard(): void {
    this.#clearTimer();
    this.#chunks = [];
    this.#size = 0;
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    this.#timers.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
