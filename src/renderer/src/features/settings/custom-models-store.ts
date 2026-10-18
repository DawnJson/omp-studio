// 设置 → 模型与账号 → 自定义提供商的渲染进程缓存：models.yml 里的 providers。
// 和 accounts-store 一样先显示上次的结果、后台刷新；保存/删除之后 force 重读，同时重读模型列表（新模型要出现在选择器里）。
import type { CustomModelsFileInfo } from "../../../../shared/custom-models.ts";
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
