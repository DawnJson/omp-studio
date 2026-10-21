// 项目目录里的短命 rpc-ui（owner 决定 2）：项目范围的内置命令（`/mcp ... --scope project`、按项目的记忆）要在项目目录里跑，
// 服务进程的 cwd 是 userData/service，不行。每个项目目录最多一个 `omp --mode rpc-ui --no-session`，空闲后关，
// 放进应用 Job Object，退出时经 command-handlers.ts 注册的 shutdown hook 全部关掉。
import { IdleOmp, type IdleOmpOptions } from "./idle-omp.ts";
import type { OmpConnection } from "../omp/omp-connection.ts";

export const PROJECT_IDLE_CLOSE_MS = 60 * 1000;

type ProcessOptions = Omit<IdleOmpOptions, "cwd" | "idleCloseMs">;

export class ProjectOmpPool {
  readonly #entries = new Map<string, IdleOmp>();
  readonly #process: ProcessOptions;
  readonly #idleCloseMs: number;
  readonly #key: (dir: string) => string;
  #closed = false;

  constructor(process: ProcessOptions, idleCloseMs: number, key: (dir: string) => string) {
    this.#process = process;
    this.#idleCloseMs = idleCloseMs;
    this.#key = key;
  }

  /** 项目进程数（测试用）。 */
  get size(): number {
    return this.#entries.size;
  }

  /** 在 `dir`（项目目录，主进程自己的记录里取的，不是渲染进程传的）的 rpc-ui 上做一件事。 */
  use<T>(dir: string, job: (connection: OmpConnection) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("the project omp pool is closed"));
    const key = this.#key(dir);
    let entry = this.#entries.get(key);
    if (!entry) {
      const created = new IdleOmp({
        ...this.#process,
        cwd: () => Promise.resolve(dir),
        idleCloseMs: this.#idleCloseMs,
      });
      created.onIdleClosed = () => {
        if (this.#entries.get(key) === created && !created.active) this.#entries.delete(key);
      };
      this.#entries.set(key, created);
      entry = created;
    }
    return entry.use(job);
  }

  /** 退出：关掉全部，之后不再接受操作。 */
  async close(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.close()));
  }
}
