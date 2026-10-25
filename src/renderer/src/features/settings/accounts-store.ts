// "提供商与账号"和"模型"两节共用的渲染进程缓存：提供商、账号、已存 key、key 变量设在哪、模型列表；"模型"一节另有非对话模型（搜索、生图、语音…）。
// 在模块里保存上次结果：再次进入设置页时立即显示，同时后台刷新（登录、退出、终端里改过都会在刷新后体现）。
// 第一次读（没有缓存）才显示加载态；后台刷新失败不盖掉已有内容，只有没有缓存时才显示错误。
import { useEffect } from "react";
import type { ModelOption, RunnerModel } from "../../../../shared/ipc.ts";
import type { LoginProvider, LogoutAccount } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { ProviderKeyEnv } from "../../../../shared/provider-keys.ts";
import { createCachedLoader, type CachedLoad } from "../../../../shared/ui/cached-loader.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import type { ModelSources } from "./role-options.ts";

interface AccountData {
  providers: LoginProvider[];
  accounts: Record<string, LogoutAccount[]>;
  /** 能填 key 的 provider 的 key 实际取自哪个变量、设在哪；和列表一起读好，卡片和填 key 的对话框打开时就是对的，不先显示默认说明再跳。 */
  keyEnv: Record<string, ProviderKeyEnv>;
  models: ModelOption[];
}

type AccountLoad = CachedLoad<AccountData>;

const store = createStore<AccountLoad>({ kind: "idle" });

/** 一次读全：provider、每个已认证 provider 的账号（OAuth 和设置页存的 API key 都在里面）、key 变量、模型。provider、key 变量或模型读不出来整体失败。 */
async function fetchAccountData(): Promise<AccountData> {
  const [providers, keyEnv, models] = await Promise.all([
    window.studio.listLoginProviders(),
    window.studio.apiKeyEnvSources(),
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
  return { providers, accounts, keyEnv, models };
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

// 非对话模型单独读：要起一次 omp 命令行（几秒），读不出来也不影响提供商页和对话模型。
const runnerStore = createStore<CachedLoad<RunnerModel[]>>({ kind: "idle" });
const runnerLoader = createCachedLoader<RunnerModel[]>(
  () => window.studio.listRunnerModels(),
  () => runnerStore.get(),
  (next) => runnerStore.set(next),
);

/**
 * 角色和备用链的候选：对话模型 + 非对话模型。进入时后台各刷新一次（有缓存就先用缓存）。
 * `runnerError`：非对话模型读不出来（也没有缓存）时的错误，界面在"特定能力"那块说一句。
 */
export function useModelSources(): ModelSources & { runnerError: unknown } {
  const accounts = useAccountLoad();
  const runners = useStoreValue(runnerStore, (state) => state);
  useEffect(() => {
    void loadAccounts();
    void runnerLoader.load();
  }, []);
  return {
    chat: accounts.kind === "ready" ? accounts.data.models : null,
    runners: runners.kind === "ready" ? runners.data : null,
    runnerError: runners.kind === "error" ? runners.error : null,
  };
}
