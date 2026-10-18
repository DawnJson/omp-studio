// "先显示缓存、后台刷新"的读取状态机（设置页的账号、用量等共用）。不碰 DOM 和 React，单测直接用。
// 世代号：force 的读取不复用进行中的旧读取，旧读取晚到的结果（发生在改动之前）一律丢弃。

export type CachedLoad<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T; refreshing: boolean; refreshError: unknown }
  | { kind: "error"; error: unknown };

export interface CachedLoader {
  /** 普通进入：合并进进行中的读取。force：登录/退出等改动之后，重新读，不复用旧的。 */
  load(force?: boolean): Promise<void>;
}

export function createCachedLoader<T>(
  fetchData: () => Promise<T>,
  get: () => CachedLoad<T>,
  set: (next: CachedLoad<T>) => void,
): CachedLoader {
  let generation = 0;
  let loading: Promise<void> | null = null;
  return {
    load(force = false) {
      if (loading && !force) return loading;
      const mine = ++generation;
      const current = get();
      if (current.kind === "ready") set({ ...current, refreshing: true, refreshError: null });
      else set({ kind: "loading" });
      const job: Promise<void> = fetchData().then(
        (data) => {
          if (mine === generation) set({ kind: "ready", data, refreshing: false, refreshError: null });
        },
        (error: unknown) => {
          if (mine !== generation) return;
          const latest = get();
          // 有缓存：保留内容，记下刷新失败给界面一个不打扰的提示；没有缓存才整体报错。
          if (latest.kind === "ready") set({ ...latest, refreshing: false, refreshError: error });
          else set({ kind: "error", error });
        },
      );
      loading = job;
      void job.finally(() => {
        if (loading === job) loading = null;
      });
      return job;
    },
  };
}
