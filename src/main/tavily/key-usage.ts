// 一个 Tavily key 的用量（不 import electron，可以单测）：Tavily 的 `GET /usage`。设置页 Tavily 的填 key 对话框里列出每个 key 用了多少。
// 见 docs/architecture/login.md「Tavily 备用 key」。

import type { TavilyKeyState } from "../../shared/ipc.ts";

const USAGE_URL = "https://api.tavily.com/usage";
const USAGE_TIMEOUT_MS = 15_000;

interface UsageReply {
  key?: { usage?: number | null; limit?: number | null };
  account?: {
    plan_usage?: number | null;
    plan_limit?: number | null;
    paygo_usage?: number | null;
    paygo_limit?: number | null;
  };
}

export interface KeyUsage {
  state: TavilyKeyState;
  /** 已用 / 上限（credits）：key 自己设了上限时是 key 的，否则是账号套餐的；回复里没有时 null。 */
  used: number | null;
  limit: number | null;
}

/**
 * `GET /usage` 的回复：key 自己设了上限（`key.limit`）就按 key 算，否则按账号套餐（`plan_usage` / `plan_limit`）算。
 * 用满了是 exhausted，除非套餐用满后还有剩余的按量付费额度（插件那边也照样能用这个 key，Tavily 不回 432）。
 */
export function usageFromReply(reply: UsageReply): KeyUsage {
  const key = reply.key;
  if (key?.limit != null) {
    const used = key.usage ?? 0;
    return { state: used >= key.limit ? "exhausted" : "ok", used, limit: key.limit };
  }
  const account = reply.account;
  if (account?.plan_limit == null) return { state: "ok", used: account?.plan_usage ?? null, limit: null };
  const used = account.plan_usage ?? 0;
  const paygoLeft = account.paygo_limit != null && (account.paygo_usage ?? 0) < account.paygo_limit;
  return { state: used >= account.plan_limit && !paygoLeft ? "exhausted" : "ok", used, limit: account.plan_limit };
}

/** 401 / 403 是无效 key；断网、限流、Tavily 出错时 unknown。 */
export async function fetchKeyUsage(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyUsage> {
  const unknown: KeyUsage = { state: "unknown", used: null, limit: null };
  let response: Response;
  try {
    response = await fetchImpl(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
  } catch {
    return unknown;
  }
  if (response.status === 401 || response.status === 403) return { state: "invalid", used: null, limit: null };
  if (!response.ok) return unknown;
  return usageFromReply((await response.json()) as UsageReply);
}
