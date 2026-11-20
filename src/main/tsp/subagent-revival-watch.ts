// 盯着已完成子代理的记录文件，认出被主代理用 IRC 唤醒、又在跑的那些（issue #23；判定规则见 shared/tsp/subagent-revival.ts）。
// omp 不更新被唤醒子代理的 `agent` 节点（一直是 done），只有 `<名字>.jsonl` 照常边跑边写。文档里有 done 的子代理时每秒
// stat 一次它们的记录文件；每个子代理从它变成 done 那一刻的文件末尾往后读（那时一轮刚结束，是停着的），之后只读新增的部分。
// 不用 fs.watch：omp 一直开着记录文件的句柄往里追加，Windows 上目录监视收不到这种写入（2026-11-20 实测：句柄开着时追加 6 次，
// 0 个事件；stat 拿到的大小是对的），真实 omp 下一次也没认出来。进程退出、换会话时 reset。
import { open, stat } from "node:fs/promises";
import { scanRevival, type RevivalState } from "../../shared/tsp/subagent-revival.ts";
import { log } from "../log/log.ts";
import { subagentPaths } from "./subagent-file.ts";

/** 多久看一次记录文件。 */
const POLL_MS = 1_000;

/** 一次最多读多少新增字节；超过时跳到末尾这么多、丢掉开头那半行（一条工具结果再大，末尾也足够判断）。 */
const READ_MAX_BYTES = 4 * 1024 * 1024;

interface Tracked {
  file: string;
  /** 已读到的字节位置；null = 还没确定起点（stat 还在路上）。 */
  offset: number | null;
  /** 上次读到的最后半行。 */
  partial: string;
  state: RevivalState;
  reading: boolean;
  /** 上一次读失败的原因：同样的错误每秒都会再来，只记一次。 */
  lastError: string | null;
}

export interface SubagentRevivalDeps {
  /** 被唤醒的集合（`running`）变了。 */
  changed(): void;
}

export class SubagentRevivalWatch {
  readonly #deps: SubagentRevivalDeps;
  #sessionFile: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  readonly #tracked = new Map<string, Tracked>();
  #running: Readonly<Record<string, number>> = {};

  constructor(deps: SubagentRevivalDeps) {
    this.#deps = deps;
  }

  /** 被唤醒、正在跑的子代理：名字 → 已读到的字节数（记录每多写一点就变，渲染进程拿它当重读记录的键）。 */
  get running(): Readonly<Record<string, number>> {
    return this.#running;
  }

  get active(): boolean {
    return Object.keys(this.#running).length > 0;
  }

  /** 文档变了：`done` 是现在文档里状态为 done 的子代理名。新出现的从文件末尾开始盯，不再是 done 的丢掉。 */
  sync(sessionFile: string | null, done: ReadonlySet<string>): void {
    if (sessionFile !== this.#sessionFile) {
      this.reset();
      this.#sessionFile = sessionFile;
    }
    let dropped = false;
    for (const name of this.#tracked.keys()) {
      if (done.has(name)) continue;
      this.#tracked.delete(name);
      dropped = true;
    }
    if (sessionFile !== null) {
      for (const name of done) {
        if (this.#tracked.has(name)) continue;
        const paths = subagentPaths(sessionFile, name);
        if (!paths) continue;
        const tracked: Tracked = {
          file: paths.jsonl,
          offset: null,
          partial: "",
          state: "idle",
          reading: false,
          lastError: null,
        };
        this.#tracked.set(name, tracked);
        void this.#start(name, tracked);
      }
    }
    this.#syncTimer();
    if (dropped) this.#publish();
  }

  /** 进程退出、换会话：不再盯，集合清空。 */
  reset(): void {
    this.#tracked.clear();
    this.#syncTimer();
    this.#publish();
  }

  async #start(name: string, tracked: Tracked): Promise<void> {
    let size = 0;
    try {
      size = (await stat(tracked.file)).size;
    } catch {
      // 还没有文件：从头读。
    }
    if (this.#tracked.get(name) === tracked) tracked.offset = size;
  }

  #syncTimer(): void {
    if (this.#tracked.size === 0) {
      clearInterval(this.#timer ?? undefined);
      this.#timer = null;
      return;
    }
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      for (const [name, tracked] of this.#tracked) void this.#read(name, tracked);
    }, POLL_MS);
    this.#timer.unref();
  }

  async #read(name: string, tracked: Tracked): Promise<void> {
    if (tracked.reading || tracked.offset === null) return;
    tracked.reading = true;
    try {
      await this.#readOnce(tracked);
      tracked.lastError = null;
    } catch (error) {
      const message = String(error);
      if (message !== tracked.lastError) log.warn("subagent revival: reading a subagent record failed", { message });
      tracked.lastError = message;
    } finally {
      tracked.reading = false;
    }
    if (this.#tracked.get(name) === tracked) this.#publish();
  }

  async #readOnce(tracked: Tracked): Promise<void> {
    const offset = tracked.offset ?? 0;
    // 还没有文件（子代理没写过）：当作没变。
    const size = await stat(tracked.file).then(
      (stats) => stats.size,
      () => offset,
    );
    if (size < offset) {
      // 文件被重写了：从新的末尾接着看。
      tracked.offset = size;
      tracked.partial = "";
      return;
    }
    if (size === offset) return;
    const skip = size - offset > READ_MAX_BYTES;
    const from = skip ? size - READ_MAX_BYTES : offset;
    const handle = await open(tracked.file, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(size - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      text = buffer.subarray(0, bytesRead).toString("utf8");
      tracked.offset = from + bytesRead;
    } finally {
      await handle.close();
    }
    if (skip) text = text.slice(text.indexOf("\n") + 1);
    else text = tracked.partial + text;
    const end = text.lastIndexOf("\n");
    tracked.partial = text.slice(end + 1);
    tracked.state = scanRevival(tracked.state, text.slice(0, end + 1));
  }

  #publish(): void {
    const next: Record<string, number> = {};
    for (const [name, tracked] of this.#tracked) {
      if (tracked.state === "running" && tracked.offset !== null) next[name] = tracked.offset;
    }
    const before = this.#running;
    const keys = Object.keys(next);
    if (keys.length === Object.keys(before).length && keys.every((name) => before[name] === next[name])) return;
    this.#running = next;
    this.#deps.changed();
  }
}
