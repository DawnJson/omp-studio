// "模型与账号"的渲染进程缓存：提供商、账号、已存 key、模型列表。
// 在模块里保存上次结果：再次进入设置页时立即显示，同时后台刷新（登录、退出、终端里改过都会在刷新后体现）。
// 第一次读（没有缓存）才显示加载态；后台刷新失败不盖掉已有内容，只有没有缓存时才显示错误。
import type { ModelOption } from "../../../../shared/ipc.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { createCachedLoader, type CachedLoad } from "../../../../shared/ui/cached-loader.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface AccountData {
  providers: LoginProvider[];
  accounts: Record<string, LogoutAccount[]>;
  keyProviders: string[];
  models: ModelOption[];
}

export type AccountLoad = CachedLoad<AccountData>;

const store = createStore<AccountLoad>({ kind: "idle" });

/** 一次读全：provider、每个已登录 provider 的账号、已存的 key、模型。provider 或模型读不出来整体失败。 */
async function fetchAccountData(): Promise<AccountData> {
  const [providers, keyProviders, models] = await Promise.all([
    window.studio.listLoginProviders(),
    window.studio.listApiKeyProviders(),
    window.studio.listModels(),
  ]);
  const accounts: Record<string, LogoutAccount[]> = {};
  await Promise.all(
    providers
      .filter((provider) => provider.authenticated)
      .map(async (provider) => {
        accounts[provider.id] = await window.studio.listAccounts(provider.id);
      }),
  );
  return { providers, accounts, keyProviders, models };
}

const loader = createCachedLoader<AccountData>(
  fetchAccountData,
  () => store.get(),
  (next) => store.set(next),
);

/** 读（或重读），见 shared/ui/cached-loader.ts。登录/退出/改 key 之后传 force=true。 */
export function loadAccounts(force = false): Promise<void> {
  return loader.load(force);
}

export function useAccountLoad(): AccountLoad {
  return useStoreValue(store, (state) => state);
}
