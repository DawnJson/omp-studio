// "用量"的渲染进程缓存：额度和热力图各一份，在模块里保存；再次进入设置页（或打开输入框下方的额度浮层）立即显示上次结果，后台刷新。
// 热力图的刷新分两步：先读现有的库（马上有东西看），再让 omp 同步新会话后重读（首次可能要几分钟）。
import type { QuotaSnapshot, UsageHeatmap } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface Slot<T> {
  data: T | null;
  /** 正在读/同步。 */
  busy: boolean;
  /** 最近一次失败；有 data 时只是"刷新没成功"，不盖掉已有内容。 */
  error: unknown;
  /** 最近一次读成功的时间。 */
  at: number | null;
}

interface UsageState {
  quota: Slot<QuotaSnapshot>;
  heatmap: Slot<UsageHeatmap>;
}

const empty = { data: null, busy: false, error: null, at: null } as const;
const store = createStore<UsageState>({ quota: empty, heatmap: empty });
let quotaJob: Promise<void> | null = null;
let heatmapJob: Promise<void> | null = null;

function patch<K extends keyof UsageState>(key: K, next: Partial<UsageState[K]>): void {
  const state = store.get();
  store.set({ ...state, [key]: { ...state[key], ...next } });
}

export function loadQuota(): Promise<void> {
  quotaJob ??= (async () => {
    patch("quota", { busy: true, error: null });
    try {
      patch("quota", { data: await window.studio.getUsageQuota(), busy: false, at: Date.now() });
    } catch (error) {
      patch("quota", { busy: false, error });
    } finally {
      quotaJob = null;
    }
  })();
  return quotaJob;
}

export function loadHeatmap(): Promise<void> {
  heatmapJob ??= (async () => {
    patch("heatmap", { busy: true, error: null });
    try {
      patch("heatmap", { data: await window.studio.getUsageHeatmap(false) });
      patch("heatmap", { data: await window.studio.getUsageHeatmap(true), busy: false, at: Date.now() });
    } catch (error) {
      patch("heatmap", { busy: false, error });
    } finally {
      heatmapJob = null;
    }
  })();
  return heatmapJob;
}

export function useUsageQuota(): Slot<QuotaSnapshot> {
  return useStoreValue(store, (state) => state.quota);
}

export function useUsageHeatmap(): Slot<UsageHeatmap> {
  return useStoreValue(store, (state) => state.heatmap);
}
