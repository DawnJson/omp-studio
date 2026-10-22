// 设置 → 提供商与账号 的提供商列表：搜索过滤和分组（纯函数）。
// omp 返回的是 80 多个 provider 的平铺列表；已配置的（登录过、环境变量/配置里有凭据、或 studio 存了 key）单独一组排前面，
// 界面上没在搜索时只先列这一组；同一组内保持 omp 给的顺序（omp 把常用的订阅类放在前面），搜索按名称和 id 匹配。

export interface ListedProvider {
  id: string;
  name: string;
  authenticated: boolean;
}

/** 名称或 id 包含查询里的每个词（不区分大小写）；空查询全部命中。 */
export function matchesProvider(provider: Pick<ListedProvider, "id" | "name">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${provider.name}\n${provider.id}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** 已配置：omp 认为已认证（登录、环境变量、配置里的 key），或 studio 自己存了 key。 */
function isConfigured(provider: Pick<ListedProvider, "id" | "authenticated">, storedKeys: readonly string[]) {
  return provider.authenticated || storedKeys.includes(provider.id);
}

/** 过滤后分成已配置的和其余的；两组内部保持原顺序。 */
export function splitProviders<T extends ListedProvider>(
  providers: readonly T[],
  storedKeys: readonly string[],
  query: string,
): { configured: T[]; others: T[] } {
  const matched = providers.filter((provider) => matchesProvider(provider, query));
  return {
    configured: matched.filter((provider) => isConfigured(provider, storedKeys)),
    others: matched.filter((provider) => !isConfigured(provider, storedKeys)),
  };
}
