// 设置 → 提供商与账号 的提供商列表：搜索过滤和分组（纯函数）。
// omp 返回的是 80 多个 provider 的平铺列表；已配置的（登录过、存了 API key、环境变量/配置里有凭据：omp 报 authenticated）单独一组排前面，
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

/** 过滤后分成已配置的（omp 报 authenticated）和其余的；两组内部保持原顺序。 */
export function splitProviders<T extends ListedProvider>(
  providers: readonly T[],
  query: string,
): { configured: T[]; others: T[] } {
  const matched = providers.filter((provider) => matchesProvider(provider, query));
  return {
    configured: matched.filter((provider) => provider.authenticated),
    others: matched.filter((provider) => !provider.authenticated),
  };
}

/**
 * 卡片第二行写的账号名：omp 给的账号名有的是内部编号（UUID、长串十六进制、`OAuth credential #9`、`API key #6`），
 * 用户看了没信息，不写（只留徽标；仓库所有者定，2026-11-11）。邮箱、用户名照写。多个账号时取第一个能读的，后面 `+N` 是其余的个数。
 */
export function accountSummary(labels: readonly string[]): string {
  const first = labels.find(
    (label) =>
      label.trim() !== "" &&
      !/^(oauth credential|api key) #\d+$/i.test(label.trim()) &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(label) &&
      !/^[0-9a-f-]{20,}$/i.test(label),
  );
  if (first === undefined) return "";
  return labels.length > 1 ? `${first} +${labels.length - 1}` : first;
}
