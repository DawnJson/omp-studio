// Tavily 备用 key 的判断（不 import electron，可以单测）：用 Tavily 的 `GET /usage` 看一个 key 还有没有额度，
// 当前 key 用完时挑第一个还有额度的备用 key。见 docs/architecture/login.md「Tavily 备用 key」。

const USAGE_URL = "https://api.tavily.com/usage";
const USAGE_TIMEOUT_MS = 15_000;

/** true 还有额度；false 用完了或 key 无效（401 / 403）；null 查不出来（断网、限流、Tavily 出错），不据此换 key。 */
export type Credits = boolean | null;

interface UsageReply {
  key?: { usage?: number | null; limit?: number | null };
  account?: {
    plan_usage?: number | null;
    plan_limit?: number | null;
    paygo_usage?: number | null;
    paygo_limit?: number | null;
  };
}

/** `GET /usage` 的回复：这个 key 自己的上限用完，或者账号的套餐额度用完且没有剩余的按量付费额度，就是用完了。 */
export function creditsFromUsage(reply: UsageReply): boolean {
  const key = reply.key;
  if (key?.limit != null && (key.usage ?? 0) >= key.limit) return false;
  const account = reply.account;
  if (account?.plan_limit == null || (account.plan_usage ?? 0) < account.plan_limit) return true;
  return account.paygo_limit != null && (account.paygo_usage ?? 0) < account.paygo_limit;
}

export async function fetchCredits(key: string, fetchImpl: typeof fetch = fetch): Promise<Credits> {
  let response: Response;
  try {
    response = await fetchImpl(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) return null;
  return creditsFromUsage((await response.json()) as UsageReply);
}

/**
 * 当前 key 用完（或没有 key）时返回要换上的备用 key：按顺序第一个确定还有额度的；不用换、或者没有能换的返回 null。
 * 当前 key 查不出来（null）时不换：可能只是断网。
 */
export async function pickReplacement(
  current: string | null,
  backups: readonly string[],
  credits: (key: string) => Promise<Credits>,
): Promise<string | null> {
  if (current !== null && (await credits(current)) !== false) return null;
  for (const key of backups) {
    if (key !== current && (await credits(key)) === true) return key;
  }
  return null;
}
