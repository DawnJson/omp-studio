// 主进程一侧的 SQLite worker（db-worker.ts）：用量热力图、请求记录、模型实测速度的只读查询都交给它跑，
// 打开库、等 WAL 写方、查询都不占主进程的事件循环。按需起，空闲一分钟后关掉；worker 崩了，在途的请求 reject，下次请求重新起。
// 不在单元测试里加载（`?modulePath` 只有 electron-vite 构建认）；查询函数本身在 heatmap.ts / session-stats.ts / model-perf.ts 里直接测。
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import workerPath from "./db-worker.ts?modulePath";
import type { DbReadKind, DbReads, DbRequest, DbResponse } from "./db-worker.ts";

const IDLE_MS = 60_000;

interface Thread {
  worker: Promise<Worker>;
  pending: Map<number, PromiseWithResolvers<unknown>>;
}

let current: Thread | null = null;
let idleTimer: NodeJS.Timeout | undefined;
let nextId = 1;

/** 在 worker 里跑一次 db-worker.ts 的查询；查询抛的错原样（名字、文字、code）重新抛出。 */
export function readInDbWorker<K extends DbReadKind>(
  kind: K,
  ...args: Parameters<DbReads[K]>
): Promise<ReturnType<DbReads[K]>> {
  clearTimeout(idleTimer);
  current ??= startThread();
  const thread = current;
  const id = nextId++;
  const request = Promise.withResolvers<unknown>();
  thread.pending.set(id, request);
  void thread.worker.then(
    (worker) => worker.postMessage({ id, kind, args } satisfies DbRequest),
    () => {},
  );
  return request.promise as Promise<ReturnType<DbReads[K]>>;
}

/**
 * 打包后 bundle 在 app.asar 里，worker 线程不能直接从 asar 加载文件（node-pty 的 worker 脚本也因此要 asarUnpack）。
 * 主线程的 fs 认得 asar：读出代码，以 data: URL 交给 worker（`?modulePath` 打出的是自包含 bundle，只 import node 内置模块）。
 */
async function spawnWorker(): Promise<Worker> {
  const code = await readFile(workerPath, "utf8");
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
  worker.unref();
  return worker;
}

function startThread(): Thread {
  const thread: Thread = { worker: spawnWorker(), pending: new Map() };
  thread.worker.then(
    (worker) => {
      worker.on("message", (response: DbResponse) => {
        const request = thread.pending.get(response.id);
        if (!request) return;
        thread.pending.delete(response.id);
        if (response.ok) request.resolve(response.value);
        else {
          const error = new Error(response.message);
          error.name = response.name;
          if (response.code !== undefined) Object.assign(error, { code: response.code });
          request.reject(error);
        }
        if (thread.pending.size === 0) scheduleIdleExit(thread);
      });
      worker.on("error", (error) => endThread(thread, error));
      worker.on("exit", (code) => endThread(thread, new Error(`the SQLite worker exited with code ${code}`)));
    },
    (error: unknown) => endThread(thread, error instanceof Error ? error : new Error(String(error))),
  );
  return thread;
}

function endThread(thread: Thread, error: Error): void {
  if (current === thread) current = null;
  for (const request of thread.pending.values()) request.reject(error);
  thread.pending.clear();
}

function scheduleIdleExit(thread: Thread): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (current !== thread || thread.pending.size > 0) return;
    current = null;
    void thread.worker.then((worker) => worker.terminate());
  }, IDLE_MS);
  idleTimer.unref();
}
