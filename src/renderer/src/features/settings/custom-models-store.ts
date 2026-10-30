// 设置 → 提供商与账号 → 自定义提供商的渲染进程缓存：models.yml 里的 providers。
// 和 accounts-store 一样先显示上次的结果、后台刷新；保存/删除之后 force 重读，同时重读模型列表（新模型要出现在选择器里）。
import type { CustomModelsFileInfo, FetchModelsOutcome } from "../../../../shared/custom-models.ts";
import { createCachedLoader, type CachedLoad } from "../../../../shared/ui/cached-loader.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { loadAccounts } from "./accounts-store.ts";

const store = createStore<CachedLoad<CustomModelsFileInfo>>({ kind: "idle" });

const loader = createCachedLoader<CustomModelsFileInfo>(
  () => window.studio.listCustomProviders(),
  () => store.get(),
  (next) => store.set(next),
);

export function loadCustomProviders(force = false): Promise<void> {
  return loader.load(force);
}

/** 保存/删除成功后：重读 models.yml 和模型列表（主进程已关掉服务进程，下次读时 omp 重新加载 models.yml）。 */
export function reloadAfterChange(): void {
  void loadCustomProviders(true);
  void loadAccounts(true);
}

export function useCustomProviderLoad(): CachedLoad<CustomModelsFileInfo> {
  return useStoreValue(store, (state) => state);
}

/** 拉取模型失败的原因（`fetchErr.*` 的 code 和 HTTP 状态码）。 */
export type FetchFailure = Omit<Extract<FetchModelsOutcome, { ok: false }>, "ok">;

// 编辑对话框里用文件里的连接（Base URL、接口类型、key）最近一次拉取的结果，按 provider id，只在内存里：
// 卡片的元信息行开头据此标出 key / 地址不可用；拉取成功、改了连接或删掉 provider 后去掉。
const fetchFailures = createStore<ReadonlyMap<string, FetchFailure>>(new Map());

export function setFetchFailure(providerId: string, failure: FetchFailure | null): void {
  const current = fetchFailures.get();
  if (failure === null && !current.has(providerId)) return;
  const next = new Map(current);
  if (failure === null) next.delete(providerId);
  else next.set(providerId, failure);
  fetchFailures.set(next);
}

export function useFetchFailures(): ReadonlyMap<string, FetchFailure> {
  return useStoreValue(fetchFailures, (state) => state);
}
