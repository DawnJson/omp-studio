// 启动时的 omp 默认（goal 自动推进、关首次运行引导）是后台任务；TSP 任务的 omp 进程要在它们完成后再起，
// 否则第一个任务读到的还是没关的引导。这里只存那个 promise。不 import electron。
let pending: Promise<void> | null = null;

/** 登记启动默认的 promise（必须不 reject：各步自己吞错、只记 WARN）。 */
export function registerStartupDefaults(promise: Promise<void>): void {
  pending = promise;
}

/** 等启动默认做完，最多 `timeoutMs`；超时或没登记都直接返回，不阻塞任务启动。 */
export async function awaitStartupDefaults(timeoutMs: number): Promise<void> {
  const current = pending;
  if (!current) return;
  const { promise: timeout, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, timeoutMs);
  try {
    await Promise.race([current.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
