// 会话信息 / 请求记录的读取：stats.db 只在 `omp stats` 运行时才同步（docs/architecture/omp-usage.md），所以和用量页一样分两步：
// 先读现有库（马上有东西看），再让 omp 同步一次后重读。同步失败只提示，已读到的数据照常显示。
import { useCallback, useEffect, useRef, useState } from "react";

export interface SyncedRead<T> {
  data: T | null;
  /** 第一步（读现有库）的错误；有值时 data 可能为 null。 */
  error: unknown;
  /** 同步还在进行。 */
  syncing: boolean;
  /** 同步（omp stats）失败的错误。 */
  syncError: unknown;
  /** 重新走一遍两步（"刷新"按钮）。 */
  refresh(): void;
}

export function useSyncedRead<T>(load: (refresh: boolean) => Promise<T>, resetKey: string): SyncedRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let current = true;
    setError(null);
    setSyncError(null);
    setSyncing(true);
    loadRef.current(false).then(
      (value) => current && setData(value),
      (cause: unknown) => current && setError(cause),
    );
    loadRef.current(true).then(
      (value) => {
        if (!current) return;
        setData(value);
        setSyncing(false);
      },
      (cause: unknown) => {
        if (!current) return;
        setSyncError(cause);
        setSyncing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [resetKey, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, syncing, syncError, refresh };
}

/** 不需要同步 stats.db 的读取（概览页：数据来自会话文件和置顶文件）：挂载时读一次，`reread` 重读。 */
export interface Read<T> {
  data: T | null;
  error: unknown;
  reread(): void;
}

export function useRead<T>(load: () => Promise<T>, resetKey: string): Read<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let current = true;
    setError(null);
    loadRef.current().then(
      (value) => current && setData(value),
      (cause: unknown) => current && setError(cause),
    );
    return () => {
      current = false;
    };
  }, [resetKey, tick]);

  const reread = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, reread };
}
