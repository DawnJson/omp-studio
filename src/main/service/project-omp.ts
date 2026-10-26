// 项目目录里的短命 rpc-ui（owner 决定 2）：项目范围的内置命令（`/mcp ... --scope project`、按项目的记忆）要在项目目录里跑，
// 服务进程的 cwd 是 userData/service，不行；斜杠菜单的命令列表（`get_available_commands`，含项目的 skill、自定义命令、扩展命令）也按任务目录取。
// 每个项目目录最多一个 `omp --mode rpc-ui --no-session`，空闲后关；同时最多留 MAX_PROJECT_PROCESSES 个（每个 omp 约 260 MB，
// 每打开一个 worktree 任务就是一个新目录），超出时先关最久没用、手上没活的。
// 放进应用 Job Object，退出时经 command-handlers.ts 注册的 shutdown hook 全部关掉。
import path from "node:path";
import type { AvailableSlashCommand } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { IdleOmp, type IdleOmpOptions } from "./idle-omp.ts";
import type { OmpConnection } from "../omp/omp-connection.ts";

export const PROJECT_IDLE_CLOSE_MS = 60 * 1000;
const MAX_PROJECT_PROCESSES = 2;

type ProcessOptions = Omit<IdleOmpOptions, "cwd" | "idleCloseMs">;

export class ProjectOmpPool {
  readonly #entries = new Map<string, IdleOmp>();
  readonly #process: ProcessOptions;
  readonly #idleCloseMs: number;
  readonly #key: (dir: string) => string;
  /** 项目进程主动发来 `available_commands_update`（含握手期间）时调用；`dir` 是创建这个进程时传的目录。 */
  onCommandsUpdate: ((dir: string, commands: AvailableSlashCommand[]) => void) | null = null;
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
    // Map 的顺序就是最近使用的顺序：用到的挪到最后。
    if (entry) this.#entries.delete(key);
    else {
      const created = new IdleOmp({
        ...this.#process,
        cwd: () => Promise.resolve(dir),
        idleCloseMs: this.#idleCloseMs,
        onSpawn: (connection) =>
          connection.onFrame((frame) => {
            if (frame.type === "available_commands_update") this.onCommandsUpdate?.(dir, frame.commands);
          }),
      });
      created.onIdleClosed = () => {
        if (this.#entries.get(key) === created && !created.active) this.#entries.delete(key);
      };
      entry = created;
    }
    this.#entries.set(key, entry);
    const result = entry.use(job);
    this.#closeOldest();
    return result;
  }

  /** 有进程的超过上限：从最久没用的关起，正在做事的跳过（做完会按空闲计时自己关）。 */
  #closeOldest(): void {
    let running = [...this.#entries.values()].filter((entry) => entry.active).length;
    for (const [key, entry] of this.#entries) {
      if (running <= MAX_PROJECT_PROCESSES) return;
      if (!entry.active || entry.busy) continue;
      this.#entries.delete(key);
      void entry.close();
      running--;
    }
  }

  /** 关掉 `root` 及其子目录里的项目进程：删目录（丢弃 worktree）之前调用，Windows 上进程的 cwd 占着目录删不掉。 */
  async closeUnder(root: string): Promise<void> {
    const rootKey = this.#key(root);
    const closing: Promise<void>[] = [];
    for (const [key, entry] of this.#entries) {
      if (key !== rootKey && !key.startsWith(rootKey + path.sep)) continue;
      this.#entries.delete(key);
      closing.push(entry.close());
    }
    await Promise.all(closing);
  }

  /** 退出：关掉全部，之后不再接受操作。 */
  async close(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.close()));
  }
}
